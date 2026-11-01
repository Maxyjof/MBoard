import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { prisma } from "./prisma.mjs";
import { cloneDoc, flushDoc, saveEdit, reverseCanvas } from "./history.mjs";
import { authenticateRequest } from "../auth/ws-session.mjs";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const ROOM_IDLE_UNLOAD_MS = 10 * 60 * 1000;

// canvasId -> room
const rooms = new Map();
// canvasId -> 正在创建中的房间（避免并发连接重复建房间，导致各自连到不同实例）
const pendingRooms = new Map();

function send(socket, payload) {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(payload, (error) => {
      if (error) socket.close();
    });
  } catch {
    socket.close();
  }
}

async function createRoom(canvasId) {
  const canvas = await prisma.canvas.findUnique({
    where: { id: canvasId },
    select: { ydoc: true },
  });

  if (!canvas) return null;

  const doc = new Y.Doc();
  if (canvas.ydoc) {
    Y.applyUpdate(doc, new Uint8Array(canvas.ydoc));
  }

  // 首次进入时把数据库里的元素快照迁移成 CRDT 结构
  if (doc.getMap("elements").size === 0) {
    const snapshot = await prisma.canvas.findUnique({
      where: { id: canvasId },
      select: { sceneJson: true },
    });

    const elements = parseSceneElements(snapshot?.sceneJson);
    if (elements.length > 0) {
      doc.transact(() => {
        const map = doc.getMap("elements");
        const order = doc.getArray("order");
        order.delete(0, order.length);
        for (const element of elements) {
          if (element && typeof element.id === "string") {
            map.set(element.id, JSON.stringify(element));
            order.push([element.id]);
          }
        }
      });
    }
  }

  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);

  const room = {
    canvasId,
    doc,
    awareness,
    conns: new Map(), // ws -> Set<clientID>
    idleTimer: null,
    destroyed: false,
    historyQueue: Promise.resolve(),
    // 持久化失败时标记脏数据，房间卸载前再兜底同步一次
    dirty: false,
    lastActor: null,
  };

  const awarenessUpdate = ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);

    if (origin && room.conns.has(origin)) {
      const controlled = room.conns.get(origin);
      for (const clientId of added) controlled.add(clientId);
      for (const clientId of removed) controlled.delete(clientId);
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed)
    );
    broadcast(room, encoding.toUint8Array(encoder));
  };

  // 文档更新：广播给同房间其他连接（Yjs 更新自身幂等，发起方跳过即可）
  const docUpdate = (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    for (const socket of room.conns.keys()) {
      if (origin === socket) continue;
      send(socket, message);
    }
  };

  awareness.on("update", awarenessUpdate);
  doc.on("update", docUpdate);

  room.cleanup = () => {
    doc.off("update", docUpdate);
    awareness.off("update", awarenessUpdate);
    awareness.destroy();
    doc.destroy();
  };

  rooms.set(canvasId, room);
  return room;
}

function parseSceneElements(sceneJson) {
  if (!sceneJson) return [];
  try {
    const parsed = JSON.parse(sceneJson);
    return Array.isArray(parsed?.elements) ? parsed.elements : [];
  } catch {
    return [];
  }
}

function broadcast(room, payload) {
  for (const socket of room.conns.keys()) {
    send(socket, payload);
  }
}

function firstMessageType(raw) {
  return decoding.readVarUint(decoding.createDecoder(raw));
}

function scheduleUnload(room) {
  clearTimeout(room.idleTimer);
  room.idleTimer = setTimeout(async () => {
    if (room.conns.size > 0) return;
    await room.historyQueue;
    // 之前落库失败的内容在房间卸载前补一次，避免静默丢失
    if (room.dirty && room.lastActor) {
      try {
        await flushDoc(prisma, room.canvasId, room.lastActor, room.doc);
      } catch (error) {
        console.error("[collab] flush before unload failed", error);
      }
    }
    room.cleanup?.();
    rooms.delete(room.canvasId);
  }, ROOM_IDLE_UNLOAD_MS);
}

async function onMessage(socket, room, raw) {
  try {
    const decoder = decoding.createDecoder(raw);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_SYNC) {
      if (room.destroyed) return;
      const candidate = cloneDoc(room.doc);
      let changed = false;
      candidate.on("update", () => { changed = true; });
      try {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, candidate, socket);
        if (changed) {
          const before = cloneDoc(room.doc);
          // 先把客户端更新应用到房间并广播，再落库：
          // 落库失败时多端内容仍然一致，房间卸载前会兜底同步一次
          Y.applyUpdate(
            room.doc,
            Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(room.doc)),
            socket
          );
          room.lastActor = socket.mboardUser.username;
          try {
            await saveEdit(prisma, room.canvasId, socket.mboardUser.username, before, room.doc);
            room.dirty = false;
          } catch (error) {
            room.dirty = true;
            console.error("[collab] 保存画板失败，将在房间卸载前重试", error);
          } finally {
            before.destroy();
          }
        }
        if (encoding.length(encoder) > 1) send(socket, encoding.toUint8Array(encoder));
      } finally {
        candidate.destroy();
      }
      return;
    }

    if (messageType === 2) {
      const command = JSON.parse(decoding.readVarString(decoder));
      const reply = encoding.createEncoder(); encoding.writeVarUint(reply, 2);
      try {
        if (command.action !== "undo" && command.action !== "redo") throw new Error("无效操作");
        const candidate = await reverseCanvas(prisma, room.canvasId, socket.mboardUser.username, room.doc, command.action === "redo");
        try { Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(room.doc)), null); } finally { candidate.destroy(); }
        encoding.writeVarString(reply, JSON.stringify({ requestId: command.requestId, ok: true }));
      } catch (error) { encoding.writeVarString(reply, JSON.stringify({ requestId: command.requestId, error: error.message || "撤销失败" })); }
      send(socket, encoding.toUint8Array(reply)); return;
    }

    if (messageType === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        room.awareness,
        decoding.readVarUint8Array(decoder),
        socket
      );
    }
  } catch (error) {
    console.error("[collab] message error", error);
  }
}

function attachSocket(socket, room, user) {
  socket.binaryType = "arraybuffer";
  socket.mboardUser = user;
  room.conns.set(socket, new Set());
  clearTimeout(room.idleTimer);

  // 同步第一步：把服务端状态摘要发给客户端
  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(syncEncoder, room.doc);
  send(socket, encoding.toUint8Array(syncEncoder));

  // 把当前在线成员状态发给新连接
  const states = room.awareness.getStates();
  if (states.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys()))
    );
    send(socket, encoding.toUint8Array(awarenessEncoder));
  }

  socket.on("message", (data) => {
    const raw = new Uint8Array(data);
    // 光标与在线状态不进历史队列，避免被数据库事务阻塞
    if (firstMessageType(raw) === MESSAGE_AWARENESS) {
      try {
        const decoder = decoding.createDecoder(raw);
        decoding.readVarUint(decoder);
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          socket
        );
      } catch (error) {
        console.error("[collab] awareness 更新失败", error);
      }
      return;
    }

    room.historyQueue = room.historyQueue
      .then(() => onMessage(socket, room, raw))
      .catch((error) => console.error("[collab] queue", error));
  });

  socket.on("close", () => {
    const controlled = room.conns.get(socket);
    room.conns.delete(socket);

    if (controlled && controlled.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        room.awareness,
        Array.from(controlled),
        null
      );
    }

    if (room.conns.size === 0) {
      scheduleUnload(room);
    }
  });

  socket.on("error", () => {
    try {
      socket.close();
    } catch {
      // 忽略
    }
  });
}

// 把协作服务挂到 Next 的 HTTP 服务器上
export function attachCollabServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    } catch {
      return;
    }

    // 支持通过 Nginx 部署在 /mboard 子路径，其余交给 Next（HMR 等）
    if (url.pathname !== "/mboard/collab" && url.pathname !== "/collab") return;

    const canvasId = url.searchParams.get("canvasId");
    if (!canvasId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    void (async () => {
      const user = await authenticateRequest(request);
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      let room = rooms.get(canvasId);
      if (!room) {
        let pending = pendingRooms.get(canvasId);
        if (!pending) {
          pending = createRoom(canvasId).finally(() => pendingRooms.delete(canvasId));
          pendingRooms.set(canvasId, pending);
        }
        room = await pending;
      }

      if (!room) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
        attachSocket(ws, room, user);
      });
    })().catch((error) => {
      console.error("[collab] upgrade failed", error);
      socket.destroy();
    });
  });

  // 心跳，清理僵死连接
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const socket of room.conns.keys()) {
        if (socket.isAlive === false) {
          socket.terminate();
          continue;
        }
        socket.isAlive = false;
        try {
          socket.ping();
        } catch {
          // 忽略
        }
      }
    }
  }, 30_000);

  wss.on("connection", (socket) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });
  });

  server.on("close", () => {
    clearInterval(heartbeat);
    for (const room of rooms.values()) {
      room.destroyed = true;
      clearTimeout(room.idleTimer);
      room.cleanup?.();
    }
    rooms.clear();
    wss.close();
  });

  return wss;
}
