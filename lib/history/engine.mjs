import { AsyncLocalStorage } from "node:async_hooks";

// 操作历史的保留窗口
export const HISTORY_DAYS = 30;
export const HISTORY_WINDOW_MS = HISTORY_DAYS * 24 * 60 * 60 * 1000;

// 事务上下文：路由处理函数通过 prisma 代理复用 withHistory 打开的事务
export const transactionContext = new AsyncLocalStorage();

// 参与历史快照的模型，顺序保证外键依赖：创建时从前到后，删除时从后到前
export const ALL_MODELS = [
  "asset",
  "board",
  "boardLabel",
  "boardList",
  "boardCard",
  "cardAttachment",
  "canvas",
  "document",
];

// 按业务裁剪快照范围，避免每次写请求都读取所有画板的 ydoc 等大字段
export const ASSET_MODELS = ["asset"];
export const BOARD_MODELS = ["board"];
export const BOARD_LABEL_MODELS = ["board", "boardLabel"];
export const BOARD_LIST_MODELS = ["board", "boardList"];
export const BOARD_CARD_MODELS = ["board", "boardCard"];
export const BOARD_TREE_MODELS = ["board", "boardLabel", "boardList", "boardCard", "cardAttachment"];
export const LIST_MODELS = ["board", "boardList", "boardCard"];
export const CARD_MODELS = ["board", "boardCard", "cardAttachment"];
export const LABEL_MODELS = ["board", "boardLabel", "boardCard"];
export const DOCUMENT_MODELS = ["document"];
export const CANVAS_MODELS = ["canvas"];
export const CANVAS_ASSET_MODELS = ["asset", "canvas"];

// 统一把对象里的二进制字段转成可 JSON 序列化的形式
export function encode(value) {
  return JSON.stringify(value, (_key, item) =>
    item instanceof Uint8Array ? { binary: Buffer.from(item).toString("base64") } : item
  );
}

// encode 的逆过程，还原 Buffer 字段（主要是画板的 ydoc）
export function decode(value) {
  return JSON.parse(value, (_key, item) => {
    if (item && typeof item === "object" && typeof item.binary === "string") {
      return Buffer.from(item.binary, "base64");
    }
    if (item?.type === "Buffer" && Array.isArray(item.data)) {
      return Buffer.from(item.data);
    }
    return item;
  });
}

// 比较时忽略自动维护的 updatedAt，避免“只是时间变了”被当成一次内容变更
export function comparable(row) {
  if (!row) return "null";
  const { updatedAt: _updatedAt, ...data } = row;
  return encode(data);
}

// 读取指定模型的全量行，键为 id；必须在同一个事务里调用
export async function snapshot(tx, models = ALL_MODELS) {
  const result = {};
  for (const model of models) {
    const rows = await tx[model].findMany();
    result[model] = new Map(rows.map((row) => [row.id, row]));
  }
  return result;
}

// 比较两次快照，返回逐行的 before/after 差异
export function difference(before, after, models = ALL_MODELS) {
  const changes = [];
  for (const model of models) {
    const previous = before[model] ?? new Map();
    const next = after[model] ?? new Map();
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const from = previous.get(id) ?? null;
      const to = next.get(id) ?? null;
      if (comparable(from) !== comparable(to)) {
        changes.push({ model, id, before: from, after: to });
      }
    }
  }
  return changes;
}

// 画板上由协作层高频维护的字段，撤销命名/描述时不能拿来比较或回写
const VOLATILE_FIELDS = {
  canvas: new Set(["lastEditor", "sceneJson", "ydoc", "version", "thumbnailAssetId"]),
};

function objectKey(change) {
  return `${change.model}:${change.id}`;
}

function fieldHasChanged(change, key) {
  const before = change.before?.[key];
  const after = change.after?.[key];
  return comparable({ value: before }) !== comparable({ value: after });
}

// 更新类操作只需要比较“这次操作真正改过的字段”
function changedFields(change) {
  if (!change.before || !change.after) return null;
  const ignored = VOLATILE_FIELDS[change.model] ?? new Set();
  return [...new Set([...Object.keys(change.before), ...Object.keys(change.after)])].filter(
    (key) => key !== "updatedAt" && key !== "createdAt" && !ignored.has(key) && fieldHasChanged(change, key)
  );
}

// 读取对象当前值并与历史预期比较，只挡“同一字段被别人或后续操作改过”的情况
function assertUnchanged(change, current, expected) {
  const fields = changedFields(change);
  if (fields === null) {
    // 创建或删除的对象必须整体一致，避免误删/误恢复
    if (comparable(current) !== comparable(expected)) {
      throw new Error("目标内容已有后续修改，请先撤销后续操作");
    }
    return;
  }
  if (!current) {
    if (expected) throw new Error("目标内容已被删除，无法撤销或重做");
    return;
  }
  for (const key of fields) {
    if (comparable({ value: current[key] }) !== comparable({ value: expected[key] })) {
      throw new Error("目标内容已有后续修改，请先撤销后续操作");
    }
  }
}

// 写入一条操作记录，并更新每个对象的最新执行者；没有变化时不产生记录
export async function record(tx, actor, title, before, models = ALL_MODELS) {
  const changes = difference(before, await snapshot(tx, models), models);
  if (changes.length > 0) {
    await tx.workOperation.create({ data: { actor, title, changes: encode(changes) } });
    for (const change of changes) {
      const id = objectKey(change);
      await tx.workHead.upsert({
        where: { id },
        create: { id, actor },
        update: { actor },
      });
    }
  }
  await tx.workOperation.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - HISTORY_WINDOW_MS) } },
  });
}

// 撤销或重做一条操作：先校验归属、目标状态与最新执行者，再整体反向写入
export async function reverse(tx, actor, id, redo) {
  const operation = await tx.workOperation.findUnique({ where: { id } });
  if (!operation || operation.actor !== actor || operation.undone !== redo) {
    throw new Error("该记录不能撤销或重做");
  }
  if (operation.createdAt < new Date(Date.now() - HISTORY_WINDOW_MS)) {
    throw new Error("该记录已超过 30 天保留期");
  }

  const changes = decode(operation.changes);
  const original = await snapshot(tx);
  // 校验时当前值应等于操作完成后的状态；写入时目标值是操作执行前的状态
  const currentExpected = (change) => (redo ? change.before : change.after);
  const targetState = (change) => (redo ? change.after : change.before);

  // 检查与写入必须处于同一个 SQLite 写事务，防止校验后被其他请求改动
  for (const change of changes) {
    const current = await tx[change.model].findUnique({ where: { id: change.id } });
    assertUnchanged(change, current, currentExpected(change));
    const latest = await tx.workHead.findUnique({ where: { id: objectKey(change) } });
    if (latest && latest.actor !== actor) {
      throw new Error("目标对象的最新执行者不是你，不能撤销或重做");
    }
  }

  // 纯更新走行内更新，只回写本次操作真正改过的字段，避免覆盖别人后续的编辑
  for (const change of changes) {
    const desired = targetState(change);
    const fields = changedFields(change);
    if (!change.before || !change.after || !desired || !fields || fields.length === 0) continue;
    const data = Object.fromEntries(fields.map((key) => [key, desired[key]]));
    await tx[change.model].update({ where: { id: change.id }, data });
  }

  // 目标状态不存在的对象要删除（撤销“创建”或重做“删除”）
  for (const model of [...ALL_MODELS].reverse()) {
    for (const change of changes.filter((item) => item.model === model)) {
      if (!targetState(change)) await tx[model].deleteMany({ where: { id: change.id } });
    }
  }

  // 操作前不存在的对象要恢复（撤销“删除”或重做“创建”）
  for (const model of ALL_MODELS) {
    for (const change of changes.filter((item) => item.model === model)) {
      const desired = targetState(change);
      const otherSide = redo ? change.before : change.after;
      if (desired && !otherSide) await tx[model].create({ data: desired });
    }
  }

  // 撤销不能顺带改动操作范围之外的对象（例如级联删除）
  const actual = difference(original, await snapshot(tx), ALL_MODELS);
  const allowed = new Set(changes.map(objectKey));
  if (actual.some((change) => !allowed.has(objectKey(change)))) {
    throw new Error("操作会影响后续创建的内容，已取消撤销");
  }

  for (const change of changes) {
    const key = objectKey(change);
    await tx.workHead.upsert({
      where: { id: key },
      create: { id: key, actor },
      update: { actor },
    });
  }
  await tx.workOperation.update({ where: { id }, data: { undone: !redo } });
}
