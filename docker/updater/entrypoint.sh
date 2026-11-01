#!/bin/sh
set -eu

# 更新容器的启动入口：准备 spool 目录、写首帧心跳、放开 git 的目录所有权检查，然后常驻跑 Node 主程序

SPOOL_DIR="${SPOOL_DIR:-/spool}"
ROOT="${MBOARD_ROOT:-}"

mkdir -p "$SPOOL_DIR/requests/processed" "$SPOOL_DIR/logs"

# 应用侧靠 heartbeat 的 mtime 判断更新服务是否可用，进程一起来就先写一帧
# 自检失败时 Node 仍会每 2 秒刷新它，页面才能显示真正的报错原因而不是「未检测到更新服务」
printf '{"at":%s,"pid":0,"phase":"starting"}\n' "$(date +%s000)" > "$SPOOL_DIR/heartbeat.json.tmp"
mv "$SPOOL_DIR/heartbeat.json.tmp" "$SPOOL_DIR/heartbeat.json"

# 容器以 root 运行，宿主机仓库属主不同时 git 会报 dubious ownership 直接拒绝操作
# 这两行失败不影响启动，缺 git 由 Node 自检给出提示
git config --global --add safe.directory '*' 2>/dev/null || true
if [ -n "$ROOT" ]; then
    git config --global --add safe.directory "$ROOT" 2>/dev/null || true
fi

echo "[updater] spool=$SPOOL_DIR root=${ROOT:-未设置}"
exec node /opt/updater/updater.mjs
