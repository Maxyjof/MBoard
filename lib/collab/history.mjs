import * as Y from "yjs";

// 历史与协作共用的保留窗口
const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// 从 Yjs 文档还原 Excalidraw 场景；单个元素损坏时跳过，不影响整张画板
export function scene(doc) {
  const map = doc.getMap("elements");
  const ids = [...new Set([...doc.getArray("order").toArray(), ...map.keys()])];
  const elements = [];
  for (const id of ids) {
    const raw = map.get(id);
    if (typeof raw !== "string") continue;
    try {
      elements.push(JSON.parse(raw));
    } catch {
      // 坏数据不应该让整次保存失败
    }
  }
  let appState = {};
  try {
    appState = JSON.parse(doc.getMap("meta").get("appState") || "{}");
  } catch {
    appState = {};
  }
  return { elements, appState };
}

export function cloneDoc(doc) {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
  return clone;
}

// 对比两份文档，返回元素、元信息与顺序的差异
function diff(before, after) {
  const changes = [];
  for (const name of ["elements", "meta"]) {
    const previous = before.getMap(name);
    const next = after.getMap(name);
    for (const key of new Set([...previous.keys(), ...next.keys()])) {
      const valueBefore = previous.get(key) ?? null;
      const valueAfter = next.get(key) ?? null;
      if (valueBefore !== valueAfter) {
        changes.push({ name, key, before: valueBefore, after: valueAfter });
      }
    }
  }

  const orderBefore = before.getArray("order").toArray();
  const orderAfter = after.getArray("order").toArray();
  const commonIds = new Set(orderBefore.filter((id) => orderAfter.includes(id)));
  const stableBefore = orderBefore.filter((id) => commonIds.has(id));
  const stableAfter = orderAfter.filter((id) => commonIds.has(id));
  if (JSON.stringify(stableBefore) !== JSON.stringify(stableAfter)) {
    changes.push({ name: "order", key: "order", before: orderBefore, after: orderAfter });
  }

  return { changes, orderBefore, orderAfter };
}

function changeKey(canvasId, change) {
  return `canvas:${canvasId}:${change.name}:${change.key}`;
}

// 落盘：更新画板内容、追加历史快照、记录每个元素的最新执行者
async function persist(tx, canvasId, actor, doc, changes) {  const snapshot = JSON.stringify(scene(doc));
  await tx.canvas.update({
    where: { id: canvasId },
    data: {
      ydoc: Buffer.from(Y.encodeStateAsUpdate(doc)),
      sceneJson: snapshot,
      version: { increment: 1 },
      lastEditor: actor,
    },
  });
  await tx.canvasHistory.create({ data: { canvasId, actor, sceneJson: snapshot } });
  for (const change of changes) {
    const id = changeKey(canvasId, change);
    await tx.workHead.upsert({ where: { id }, create: { id, actor }, update: { actor } });
  }
  const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS);
  await tx.canvasOperation.deleteMany({ where: { createdAt: { lt: cutoff } } });
  await tx.canvasHistory.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

// 保存一次协作编辑：只有真正产生差异时才记录撤销单元
export async function saveEdit(db, canvasId, actor, before, after) {
  const payload = diff(before, after);
  await db.$transaction(
    async (tx) => {
      if (payload.changes.length > 0) {
        await tx.canvasOperation.create({
          data: { canvasId, actor, changes: JSON.stringify(payload) },
        });
      }
      await persist(tx, canvasId, actor, after, payload.changes);
    },
    { timeout: 30000 }
  );
}

// 兜底落盘：只同步当前文档，不产生新的撤销单元，用于持久化失败后的补偿
export async function flushDoc(db, canvasId, actor, doc) {
  const snapshot = JSON.stringify(scene(doc));
  await db.canvas.update({
    where: { id: canvasId },
    data: {
      ydoc: Buffer.from(Y.encodeStateAsUpdate(doc)),
      sceneJson: snapshot,
      lastEditor: actor,
    },
  });
}

// 把缺失的元素按历史顺序插回 order，不重排其他元素
function restoreOrder(order, ids, referenceOrder) {
  const current = order.toArray();
  for (const id of ids) {
    if (current.includes(id)) continue;
    const referenceIndex = referenceOrder.indexOf(id);
    if (referenceIndex < 0) {
      current.push(id);
      continue;
    }
    const following = referenceOrder
      .slice(referenceIndex + 1)
      .find((item) => current.includes(item));
    if (following) current.splice(current.indexOf(following), 0, id);
    else current.push(id);
  }
  order.delete(0, order.length);
  order.push(current);
}

/**
 * 撤销或重做画板里的元素操作。
 * 只允许操作本人记录，且每个元素的最新执行者必须是本人。
 */
export async function reverseCanvas(db, canvasId, actor, doc, redo) {
  const next = cloneDoc(doc);
  try {
    await db.$transaction(
      async (tx) => {
        const operation = await tx.canvasOperation.findFirst({
          where: {
            canvasId,
            actor,
            undone: redo,
            createdAt: { gte: new Date(Date.now() - HISTORY_WINDOW_MS) },
          },
          orderBy: redo ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (!operation) throw new Error(redo ? "没有可重做的操作" : "没有可撤销的操作");

        const payload = JSON.parse(operation.changes);
        for (const change of payload.changes) {
          const head = await tx.workHead.findUnique({ where: { id: changeKey(canvasId, change) } });
          if (!head || head.actor !== actor) {
            throw new Error("目标对象的最新执行者不是你，不能撤销或重做");
          }
          const current =
            change.name === "order"
              ? doc.getArray("order").toArray()
              : doc.getMap(change.name).get(change.key) ?? null;
          const expected = redo ? change.before : change.after;
          if (JSON.stringify(current) !== JSON.stringify(expected)) {
            throw new Error("目标对象已有后续修改，不能撤销或重做");
          }
        }

        // 只有本次操作确实动过顺序时才整体写回顺序
        const targetOrder = redo ? payload.orderAfter : payload.orderBefore;
        const hasOrderChange = payload.changes.some((change) => change.name === "order");
        const restoredIds = [];
        for (const change of payload.changes) {
          if (change.name !== "elements") continue;
          const value = redo ? change.after : change.before;
          if (value) restoredIds.push(change.key);
        }

        next.transact(() => {
          for (const change of payload.changes) {
            if (change.name === "order") continue;
            const value = redo ? change.after : change.before;
            const map = next.getMap(change.name);
            if (value === null) map.delete(change.key);
            else map.set(change.key, value);
          }

          // 以历史顺序为基准，但保留其他人在此之后新增的元素，不能整份覆盖
          const elements = next.getMap("elements");
          const order = next.getArray("order");
          const base = hasOrderChange ? targetOrder : order.toArray();
          const ids = base.filter((id) => elements.has(id));
          for (const id of order.toArray()) {
            if (elements.has(id) && !ids.includes(id)) ids.push(id);
          }
          order.delete(0, order.length);
          order.push(ids);
          restoreOrder(order, restoredIds, targetOrder);
        });

        await persist(tx, canvasId, actor, next, payload.changes);
        await tx.canvasOperation.update({ where: { id: operation.id }, data: { undone: !redo } });
      },
      { timeout: 30000 }
    );
    return next;
  } catch (error) {
    next.destroy();
    throw error;
  }
}
