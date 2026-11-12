// 开发用假更新服务：不需要 docker 和 git，按 docs/UPDATE.md 的协议模拟整个更新流程
// 用法：
//   node scripts/mock-updater.mjs                 模拟成功更新
//   MOCK_FAIL=1 node scripts/mock-updater.mjs     模拟构建失败后自动回滚
//   MOCK_UP_TO_DATE=1 node scripts/mock-updater.mjs 模拟已经是最新版本
// 它只写 spool 目录，永远不碰真实代码，可以随便跑

import fs from "node:fs";
import path from "node:path";

const SPOOL = process.env.UPDATE_SPOOL_DIR
  ? path.resolve(process.env.UPDATE_SPOOL_DIR)
  : path.join(process.cwd(), "data", "update");
const REQUESTS = path.join(SPOOL, "requests");
const PROCESSED = path.join(REQUESTS, "processed");
const LOGS = path.join(SPOOL, "logs");

const FAIL = process.env.MOCK_FAIL === "1";
const UP_TO_DATE = process.env.MOCK_UP_TO_DATE === "1";

const CURRENT = "3d1e9c4";
const CURRENT_FULL = "3d1e9c4a1b2c3d4e5f60718293a4b5c6d7e8f901";
const LATEST = "9a7b210";
const LATEST_FULL = "9a7b210f1e2d3c4b5a69788796a5b4c3d2e1f001";

const COMMITS = [
  {
    sha: "9a7b210",
    subject: "feat(system): 主页一键检查更新与强制更新",
    author: "dev",
    date: "2025-11-01",
  },
  {
    sha: "5c4d3e2",
    subject: "fix(canvas): 组合卡片拖动时不再丢失焦点",
    author: "dev",
    date: "2025-10-31",
  },
  {
    sha: "1f0e9d8",
    subject: "chore: 更新依赖与构建脚本",
    author: "dev",
    date: "2025-10-30",
  },
];

fs.mkdirSync(REQUESTS, { recursive: true });
fs.mkdirSync(PROCESSED, { recursive: true });
fs.mkdirSync(LOGS, { recursive: true });

let status = {
  schema: 1,
  phase: "idle",
  message: "",
  requestId: null,
  actor: null,
  current: CURRENT,
  currentFull: CURRENT_FULL,
  latest: null,
  latestFull: null,
  behind: 0,
  ahead: 0,
  commits: [],
  deadline: null,
  checkedAt: null,
  updatedAt: Date.now(),
  error: null,
  rolledBack: false,
  logFile: null,
};

// 原子写入，和应用侧保持一致
// Windows 上杀毒或索引服务偶尔会占用目标文件让 rename 失败，这里重试几次
function writeJson(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.renameSync(temp, file);
      return;
    } catch (error) {
      if (attempt === 19) {
        console.error(`[mock-updater] 写入 ${path.basename(file)} 失败: ${error.message}`);
        try {
          fs.rmSync(temp, { force: true });
        } catch {
          // 忽略
        }
        return;
      }
      // 同步小睡 20ms 再试，避免把主循环拖住
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

function saveStatus(patch = {}) {
  status = { ...status, ...patch, updatedAt: Date.now() };
  writeJson(path.join(SPOOL, "status.json"), status);
}

function appendLog(requestId, line) {
  const file = path.join(LOGS, `${requestId}.log`);
  fs.appendFileSync(file, `${line}\n`, "utf8");
}

function heartbeat() {
  writeJson(path.join(SPOOL, "heartbeat.json"), { at: Date.now(), pid: process.pid });
}

// 处理一个 check 请求
function handleCheck(request) {
  if (UP_TO_DATE) {
    saveStatus({
      phase: "up_to_date",
      message: "已经是最新版本",
      requestId: request.id,
      actor: request.actor,
      current: CURRENT,
      currentFull: CURRENT_FULL,
      latest: CURRENT,
      latestFull: CURRENT_FULL,
      behind: 0,
      ahead: 0,
      commits: [],
      checkedAt: Date.now(),
      error: null,
      rolledBack: false,
    });
    return;
  }

  saveStatus({
    phase: "update_available",
    message: `发现 ${COMMITS.length} 个新提交`,
    requestId: request.id,
    actor: request.actor,
    current: CURRENT,
    currentFull: CURRENT_FULL,
    latest: LATEST,
    latestFull: LATEST_FULL,
    behind: COMMITS.length,
    ahead: 0,
    commits: COMMITS,
    checkedAt: Date.now(),
    error: null,
    rolledBack: false,
  });
}

let applyingTimer = null;

// 处理一个 update 请求：先写倒计时，到点再走构建流程
function handleUpdate(request) {
  if (applyingTimer) return;

  saveStatus({
    phase: "countdown",
    message: "等待倒计时结束",
    requestId: request.id,
    actor: request.actor,
    deadline: request.deadline,
    latest: LATEST,
    latestFull: LATEST_FULL,
    behind: COMMITS.length,
    commits: COMMITS,
    checkedAt: Date.now(),
    error: null,
    rolledBack: false,
    logFile: `logs/${request.id}.log`,
  });
}

// 倒计时到点后模拟构建与重启
function startApplying(requestId, actor) {
  const logFile = `logs/${requestId}.log`;
  appendLog(requestId, "[mock] git fetch origin main");
  appendLog(requestId, "[mock] git reset --hard 9a7b210f1e2d3c4b5a69788796a5b4c3d2e1f001");
  appendLog(requestId, "[mock] docker compose build mboard");
  saveStatus({ phase: "applying", message: "正在构建镜像…", logFile, deadline: null });

  applyingTimer = setTimeout(() => {
    if (FAIL) {
      appendLog(requestId, "[mock] ERROR: next build failed: Module not found");
      appendLog(requestId, "[mock] 开始回滚到 3d1e9c4");
      saveStatus({ phase: "applying", message: "更新失败，正在回滚…", rolledBack: true });
      applyingTimer = setTimeout(() => {
        saveStatus({
          phase: "failed",
          message: "",
          current: CURRENT,
          currentFull: CURRENT_FULL,
          error: "构建失败：Module not found: Can't resolve './missing'",
          rolledBack: true,
          actor,
        });
        applyingTimer = null;
      }, 3000);
      return;
    }

    appendLog(requestId, "[mock] docker compose up -d --no-deps mboard");
    appendLog(requestId, "[mock] 健康检查通过 http://mboard:3000/mboard/login");
    saveStatus({
      phase: "done",
      message: "更新完成",
      current: LATEST,
      currentFull: LATEST_FULL,
      latest: LATEST,
      latestFull: LATEST_FULL,
      behind: 0,
      commits: [],
      error: null,
      logFile,
    });
    writeJson(path.join(SPOOL, "build.json"), {
      commit: LATEST,
      full: LATEST_FULL,
      builtAt: Date.now(),
    });
    applyingTimer = null;
  }, 6000);
}

// 扫描并处理请求，一次只处理一个
function scan() {
  if (status.phase === "countdown" || status.phase === "applying") return;

  const names = fs
    .readdirSync(REQUESTS)
    .filter((name) => name.endsWith(".json"))
    .sort();

  if (names.length === 0) return;

  const name = names[0];
  const file = path.join(REQUESTS, name);
  let request;
  try {
    request = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }

  try {
    fs.renameSync(file, path.join(PROCESSED, name));
  } catch {
    return;
  }

  if (request.type === "check") handleCheck(request);
  else if (request.type === "update") handleUpdate(request);
}

heartbeat();
// 启动时假装从仓库里查过一遍，让页面能提前显示有新版本
saveStatus({ phase: "idle", latest: LATEST, latestFull: LATEST_FULL, behind: COMMITS.length, commits: COMMITS, current: CURRENT });
console.log(`[mock-updater] spool: ${SPOOL}`);
console.log(`[mock-updater] 已启动, FAIL=${FAIL} UP_TO_DATE=${UP_TO_DATE}`);

setInterval(heartbeat, 2000);
setInterval(scan, 500);

// 倒计时到点就进入构建
setInterval(() => {
  if (status.phase === "countdown" && status.deadline && Date.now() >= status.deadline) {
    startApplying(status.requestId, status.actor);
  }
}, 500);
