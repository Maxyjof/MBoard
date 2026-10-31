import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

export type CollabStatus = "connecting" | "connected" | "disconnected";

export type CollabOptions = {
  canvasId: string;
  doc?: Y.Doc;
  onStatus?: (status: CollabStatus) => void;
  onSynced?: () => void;
};

// 浏览器端 Yjs WebSocket 连接：负责协议握手、断线重连与状态广播
export class CollabConnection {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  status: CollabStatus = "connecting";

  private canvasId: string;
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private synced = false;
  private onStatus?: (status: CollabStatus) => void;
  private onSynced?: () => void;

  constructor({ canvasId, doc = new Y.Doc(), onStatus, onSynced }: CollabOptions) {
    this.canvasId = canvasId;
    this.doc = doc;
    this.onStatus = onStatus;
    this.onSynced = onSynced;
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);
    this.connect();
  }

  // 本地产生的文档变更推给服务端（origin 为远端应用时跳过，避免回声）
  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  // 本地光标/在线状态广播
  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === this) return;

    const changed = added.concat(updated, removed);
    if (changed.length === 0) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
    );
    this.send(encoding.toUint8Array(encoder));
  };

  private setStatus(status: CollabStatus) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  private send(payload: Uint8Array) {
    this.socket?.send(payload);
  }

  private connect() {
    if (this.destroyed) return;
    this.setStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/mboard/collab?canvasId=${encodeURIComponent(
      this.canvasId
    )}`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      if (this.destroyed) return;
      this.reconnectAttempts = 0;
      this.setStatus("connected");

      // 握手：同步第一步 + 本地状态
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.send(encoding.toUint8Array(encoder));

      const localState = this.awareness.getLocalState();
      if (localState) {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, 1);
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
        );
        this.send(encoding.toUint8Array(awarenessEncoder));
      }
    };

    socket.onmessage = (event) => {
      const data = event.data;
      if (!(data instanceof ArrayBuffer)) return;
      this.handleMessage(new Uint8Array(data));
    };

    socket.onclose = () => {
      this.socket = null;
      if (this.destroyed) return;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose 会接着触发，这里不重复处理
    };
  }

  private handleMessage(data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);

    if (messageType === 0) {
      encoding.writeVarUint(encoder, 0);
      const type = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);

      if (type === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        this.onSynced?.();
      }

      if (encoding.length(encoder) > 1) {
        this.send(encoding.toUint8Array(encoder));
      }
      return;
    }

    if (messageType === 2) {
      const reply = JSON.parse(decoding.readVarString(decoder));
      const pending = this.historyRequests.get(reply.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.historyRequests.delete(reply.requestId);
      if (reply.ok) pending.resolve();
      else pending.reject(new Error(reply.error || "操作失败"));
      return;
    }

    if (messageType === 1) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        this
      );
    }
  }

  private historyRequests = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  // 局域网 http 访问时 crypto.randomUUID 可能不存在，这里做降级
  private newRequestId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  changeHistory(action: "undo" | "redo"): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("请连接到协作服务后重试"));
    }
    const requestId = this.newRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.historyRequests.delete(requestId);
        reject(new Error("等待响应超时，请检查画板状态"));
      }, 30000);
      this.historyRequests.set(requestId, { resolve, reject, timer });
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 2);
      encoding.writeVarString(encoder, JSON.stringify({ requestId, action }));
      this.send(encoding.toUint8Array(encoder));
    });
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  destroy() {
    this.destroyed = true;

    // 断线时让挂起的撤销请求立刻失败，避免按钮长时间卡在忙碌状态
    for (const pending of this.historyRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("连接已断开"));
    }
    this.historyRequests.clear();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    this.awareness.destroy();

    try {
      this.socket?.close();
    } catch {
      // 忽略
    }
    this.socket = null;
  }
}
