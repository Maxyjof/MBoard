import fs from "node:fs";
import path from "node:path";

// 轻量 .env 加载：Next 自己的进程也会读取，但 server.mjs 里的协作服务启动更早
function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) result[key] = value;
  }
  return result;
}

export function loadEnv(rootDir = process.cwd()) {
  const files = [".env", ".env.local"];

  for (const file of files) {
    const filePath = path.join(rootDir, file);
    if (!fs.existsSync(filePath)) continue;

    const parsed = parseEnv(fs.readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
