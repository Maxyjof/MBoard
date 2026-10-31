// 把 vditor 的静态资源复制到 public/vditor，开发与构建阶段都需要
// 生产镜像原本在 Dockerfile 里手工复制，这里统一成脚本，避免本地开发时编辑器加载不到资源
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, "node_modules", "vditor", "dist");
const target = path.join(root, "public", "vditor", "dist");

if (!fs.existsSync(source)) {
  console.error(`[vditor] 找不到资源目录：${source}，请先安装依赖`);
  process.exit(1);
}

// 先清空再复制，避免依赖升级后残留旧文件
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

console.log(`[vditor] 静态资源已同步到 ${path.relative(root, target)}`);
