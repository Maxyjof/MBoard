import * as Y from "yjs";

// 本地事务标记，用于区分「自己写入」和「远端同步进来」的变更
const LOCAL_ORIGIN = { source: "mboard-local" };

type ElementLike = {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  [key: string]: unknown;
};

type SyncMark = { version: number; versionNonce: number };

// 把 Excalidraw 的场景元素映射到 Yjs：
// elements: id -> 元素 JSON（同一元素的并发修改走 LWW，不同元素互不影响）
// order:    元素 z 轴顺序
// meta:     画布配置（背景色等）
export class SceneBinding {
  readonly doc: Y.Doc;
  private elementMap: Y.Map<string>;
  private orderArray: Y.Array<string>;
  private meta: Y.Map<string>;
  private marks = new Map<string, SyncMark>();
  private backgroundColor: string | null = null;

  constructor(doc: Y.Doc, onRemoteChange: () => void) {
    this.doc = doc;
    this.elementMap = doc.getMap<string>("elements");
    this.orderArray = doc.getArray<string>("order");
    this.meta = doc.getMap<string>("meta");

    const observer = (_event: unknown, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      onRemoteChange();
    };

    this.elementMap.observe(observer);
    this.orderArray.observe(observer);
  }

  get isEmpty() {
    return this.elementMap.size === 0;
  }

  // 按 z 轴顺序读出元素，过滤损坏 JSON 与重复 id
  readElements<T = ElementLike>(): T[] {
    const order = this.orderArray.toArray();
    const result: T[] = [];
    const seen = new Set<string>();

    const push = (id: string) => {
      if (seen.has(id)) return;
      const raw = this.elementMap.get(id);
      if (typeof raw !== "string") return;
      seen.add(id);
      try {
        result.push(JSON.parse(raw) as T);
      } catch {
        // 忽略损坏元素
      }
    };

    for (const id of order) push(id);
    this.elementMap.forEach((_value, id) => push(id));
    return result;
  }

  readBackgroundColor(): string | null {
    const raw = this.meta.get("appState");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed?.viewBackgroundColor === "string" ? parsed.viewBackgroundColor : null;
    } catch {
      return null;
    }
  }

  readAppState(): Record<string, unknown> {
    const raw = this.meta.get("appState");
    if (!raw) return {};
    try {
      return JSON.parse(raw) ?? {};
    } catch {
      return {};
    }
  }

  // 记录已同步版本，避免远端 updateScene 后又把自己的回显写回去
  markSynced(elements: readonly ElementLike[]) {
    this.marks = new Map(
      elements.map((element) => [
        element.id,
        { version: element.version, versionNonce: element.versionNonce },
      ])
    );
  }

  // 把编辑器里的本地变化写进 Yjs
  applyLocal(
    elements: readonly ElementLike[],
    appState?: { viewBackgroundColor?: string }
  ) {
    const alive = elements.filter((element) => !element.isDeleted);
    const nextMarks = new Map<string, SyncMark>();
    const changed: Array<{ id: string; json: string }> = [];

    for (const element of alive) {
      nextMarks.set(element.id, {
        version: element.version,
        versionNonce: element.versionNonce,
      });

      const previous = this.marks.get(element.id);
      if (
        !previous ||
        previous.version !== element.version ||
        previous.versionNonce !== element.versionNonce
      ) {
        changed.push({ id: element.id, json: JSON.stringify(element) });
      }
    }

    const removed = Array.from(this.marks.keys()).filter((id) => !nextMarks.has(id));
    const backgroundChanged =
      Boolean(appState?.viewBackgroundColor) &&
      appState?.viewBackgroundColor !== this.backgroundColor;

    if (changed.length === 0 && removed.length === 0 && !backgroundChanged) {
      this.marks = nextMarks;
      return;
    }

    this.doc.transact(() => {
      for (const item of changed) {
        this.elementMap.set(item.id, item.json);
      }
      for (const id of removed) {
        this.elementMap.delete(id);
      }

      this.reconcileOrder(alive.map((element) => element.id));

      if (appState?.viewBackgroundColor) {
        this.backgroundColor = appState.viewBackgroundColor;
        this.meta.set(
          "appState",
          JSON.stringify({ viewBackgroundColor: appState.viewBackgroundColor })
        );
      }
    }, LOCAL_ORIGIN);

    this.marks = nextMarks;
  }

  // 用尽量小的改动把 order 数组对齐到目标顺序，减少多人同时编辑时的冲突
  private reconcileOrder(ids: string[]) {
    const current = this.orderArray.toArray();
    if (current.length === ids.length && current.every((id, index) => id === ids[index])) {
      return;
    }

    const wanted = new Set(ids);

    // 先删掉已不存在的元素
    for (let index = current.length - 1; index >= 0; index -= 1) {
      const id = current[index];
      if (!wanted.has(id)) {
        this.orderArray.delete(index, 1);
      }
    }

    // 再按目标位置逐个校正
    for (let index = 0; index < ids.length; index += 1) {
      if (this.orderArray.get(index) === ids[index]) continue;

      let existing = -1;
      for (let probe = index + 1; probe < this.orderArray.length; probe += 1) {
        if (this.orderArray.get(probe) === ids[index]) {
          existing = probe;
          break;
        }
      }

      if (existing >= 0) {
        this.orderArray.delete(existing, 1);
      }
      this.orderArray.insert(index, [ids[index]]);
    }
  }
}
