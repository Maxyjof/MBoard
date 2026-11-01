import { WebSocketServer } from "ws";
import { authenticateRequest } from "../auth/ws-session.mjs";

// 系统通知通道：把「网站即将强制更新」在一秒内推给所有在线用户
// 它只负责通知，页面判断真相永远看 GET /api/system/status，断线也不影响功能
// 连接地址 ws://<host>/mboard/system（子路径部署）或 /system

const HUB_KEY = "__mbSystemHub";

// 广播中枢挂在 globalThis 上，避免 Next 的打包产物和 server.mjs 各拿一份模块实例
const hub = {
  clients: new Set(),
  // 向所有在线连接推送一条 JSON 消息
  publish(payload) {
    if (hub.clients.size === 0) return 0;
    const text = JSON.stringify(payload);
    let sent = 0;
    for (const socket of hub.clients) {
      if (socket.readyState !== socket.OPEN) continue;
      try {
        socket.send(text);
        sent += 1;
      } catch {
        socket.terminate();
      }
    }
    return sent;
  },
  size() {
    return hub.clients.size;
  },
};

export function getSystemHub() {
  return hub;
}

// 把系统通知通道挂到 Next 共用的 HTTP 服务器上
export function attachSystemSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    } catch {
      return;
    }

    // 不是系统通道就交给其他 upgrade 监听器处理
    if (url.pathname !== "/mboard/system" && url.pathname !== "/system") return;

    void (async () => {
      const user = await authenticateRequest(request);
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        setupSocket(ws, user);
      });
    })().catch((error) => {
      console.error("[system] upgrade failed", error);
      socket.destroy();
    });
  });

  // 单条连接的收发逻辑
  function setupSocket(socket, user) {
    socket.isAlive = true;
    socket.mboardUser = user;
    hub.clients.add(socket);

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message?.type === "ping") {
        try {
          socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
        } catch {
          socket.terminate();
        }
      }
    });

    socket.on("close", () => {
      hub.clients.delete(socket);
    });

    socket.on("error", () => {
      hub.clients.delete(socket);
      try {
        socket.close();
      } catch {
        // 忽略
      }
    });
  }

  // 心跳，清掉已经断掉的连接
  const heartbeat = setInterval(() => {
    for (const socket of hub.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        hub.clients.delete(socket);
        continue;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        hub.clients.delete(socket);
      }
    }
  }, 30_000);

  server.on("close", () => {
    clearInterval(heartbeat);
    for (const socket of hub.clients) {
      try {
        socket.terminate();
      } catch {
        // 忽略
      }
    }
    hub.clients.clear();
    wss.close();
  });

  globalThis[HUB_KEY] = hub;
  return wss;
}

// 广播一条状态变更，Next 的接口路由通过 globalThis 复用同一个中枢
export function broadcastSystem(payload) {
  return hub.publish(payload);
}
