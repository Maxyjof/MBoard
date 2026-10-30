import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { jwtVerify } from "jose";
import { prisma } from "./prisma.mjs";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const PERSIST_DEBOUNCE_MS = 900;
const ROOM_IDLE_UNLOAD_MS = 10 * 60 * 1000;

// canvasId -> room
const rooms = new Map();
// canvasId -> 正在创建中的房间（避免并发连接重复建房间，导致各自连到不同实例）
const pendingRooms = new Map();

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 未配置");
  return new TextEncoder().encode(secret);
}

function parseCookies(header = "") {
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

async function authenticate(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const token = cookies.mb_session;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      username: payload.sub,
      displayName: typeof payload.name === "string" ? payload.name : payload.sub,
      color: typeof payload.color === "string" ? payload.color : "#6353f5",
    };
  } catch {
    return null;
  }
}

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
    persistTimer: null,
    idleTimer: null,
    destroyed: false,
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
    schedulePersist(room);

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

function schedulePersist(room) {
  if (room.persistTimer) return;
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    void persistRoom(room);
  }, PERSIST_DEBOUNCE_MS);
}

async function persistRoom(room) {
  if (room.destroyed) return;

  try {
    const update = Y.encodeStateAsUpdate(room.doc);
    const elementMap = room.doc.getMap("elements");
    const order = room.doc.getArray("order").toArray();
    const elements = [];
    const seen = new Set();

    // 按协作层维护的 z 轴顺序还原元素顺序
    for (const id of order) {
      const value = elementMap.get(id);
      if (typeof value !== "string" || seen.has(id)) continue;
      try {
        elements.push(JSON.parse(value));
        seen.add(id);
      } catch {
        // 忽略损坏的元素
      }
    }

    elementMap.forEach((value, id) => {
      if (typeof value !== "string" || seen.has(id)) return;
      try {
        elements.push(JSON.parse(value));
        seen.add(id);
      } catch {
        // 忽略损坏的元素
      }
    });

    let appState = {};
    const metaValue = room.doc.getMap("meta").get("appState");
    if (typeof metaValue === "string") {
      try {
        appState = JSON.parse(metaValue);
      } catch {
        appState = {};
      }
    }

    await prisma.canvas.update({
      where: { id: room.canvasId },
      data: {
        ydoc: Buffer.from(update),
        sceneJson: JSON.stringify({ elements, appState }),
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    // 画板可能已被删除，忽略写入失败
    if (!error?.code || error.code !== "P2025") {
      console.error("[collab] persist failed", room.canvasId, error);
    }
  }
}

function scheduleUnload(room) {
  clearTimeout(room.idleTimer);
  room.idleTimer = setTimeout(async () => {
    if (room.conns.size > 0) return;
    await persistRoom(room);
    room.cleanup?.();
    rooms.delete(room.canvasId);
  }, ROOM_IDLE_UNLOAD_MS);
}

function onMessage(socket, room, raw) {
  try {
    const decoder = decoding.createDecoder(raw);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_SYNC) {
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, socket);
      if (encoding.length(encoder) > 1) {
        send(socket, encoding.toUint8Array(encoder));
      }
      return;
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
    onMessage(socket, room, new Uint8Array(data));
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
      schedulePersist(room);
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

  // 首次连入时广播自己的身份，便于其他端显示在线成员
  if (user) {
    socket.on("open", () => undefined);
  }
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
      const user = await authenticate(request);
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
      room.cleanup?.();
    }
    rooms.clear();
    wss.close();
  });

  return wss;
}
