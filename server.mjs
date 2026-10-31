import { createServer } from "node:http";
import next from "next";
import { loadEnv } from "./lib/env.mjs";
import { attachCollabServer } from "./lib/collab/server.mjs";

loadEnv(process.cwd());

const dev = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
// 保证在不依赖 cross-env 的前提下运行模式正确
process.env.NODE_ENV = dev ? "development" : "production";

const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((request, response) => {
  void handle(request, response);
});

// 协作 WebSocket 与 Next 共用同一端口
attachCollabServer(server);

server.listen(port, hostname, () => {
  console.log(
    `\n  MBoard ${dev ? "开发模式" : "生产模式"} 已启动\n  ➜  http://localhost:${port}\n  ➜  协作通道 ws://localhost:${port}/collab\n`
  );
});

// 容器里收到退出信号时优雅关闭
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  });
}
