#!/bin/sh
set -eu

# 数据目录与上传目录首次启动时自动创建
mkdir -p /app/data/uploads

echo "[mboard] 同步数据库结构..."
npx --no-install prisma db push --skip-generate

echo "[mboard] 检查种子数据..."
node prisma/seed.mjs

echo "[mboard] 启动服务..."
exec node server.mjs
