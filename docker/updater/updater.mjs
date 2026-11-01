//docker/updater/updater.mjs
//更新容器的主程序：每秒轮询spool里的请求队列，执行git拉取与docker compose重建，
//构建后用健康检查确认新版本真的起来了，失败则回滚到上一个提交
//所有进度都原子写入status.json供应用侧读取，心跳写heartbeat.json证明进程还活着
//本进程只操作mboard这一个服务，永远不会重建自己所在的mboard-updater容器：
//一旦它去重建更新容器，进程会在执行到一半时被杀掉，失败之后就再没有谁来收尾了

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

//spool根目录，与docker-compose.yml里挂载的 /spool对应
const SPOOL_DIR = process.env.SPOOL_DIR || "/spool";
//宿主机项目根的绝对路径，容器里挂到同一路径，compose解析出的宿主路径才不会错位
const ROOT_RAW = String(process.env.MBOARD_ROOT || "").trim();
const ROOT = ROOT_RAW ? path.resolve(ROOT_RAW) : "";

const STATUS_FILE = path.join(SPOOL_DIR, "status.json");
const HEARTBEAT_FILE = path.join(SPOOL_DIR, "heartbeat.json");
const BUILD_FILE = path.join(SPOOL_DIR, "build.json");
const APP_FILE = path.join(SPOOL_DIR, "app.json");
const REQUESTS_DIR = path.join(SPOOL_DIR, "requests");
const PROCESSED_DIR = path.join(REQUESTS_DIR, "processed");
const LOGS_DIR = path.join(SPOOL_DIR, "logs");

const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 2000;
const HEALTH_TIMEOUT_MS = 150000;
const HEALTH_INTERVAL_MS = 2000;
const HEALTH_REQUEST_TIMEOUT_MS = 5000;
//先试站点实际使用的路径，兜底再试不带前缀的路径
const HEALTH_URLS = ["http://mboard:3000/mboard/login", "http://mboard:3000/login"];
const RESTART_WAIT_MS = 90000;
const PROCESSED_KEEP = 20;
const COUNTDOWN_DEFAULT_MS = 15000;
const GIT_TIMEOUT_MS = 60000;
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;
const COMPOSE_TIMEOUT_MS = 5 * 60 * 1000;
//所有git操作都必须禁用交互式凭据提示，否则容器里会卡在等输入
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

//唯一状态源，字段与docs/UPDATE.md第3.1节一致
let status = {
  schema: 1,
  phase: "idle",
  message: "",
  requestId: null,
  actor: null,
  current: null,
  currentFull: null,
  latest: null,
  latestFull: null,
  behind: 0,
  ahead: 0,
  commits: [],
  deadline: null,
  //还没检查过就给null，避免页面把它当成1970年显示
  checkedAt: null,
  updatedAt: 0,
  error: null,
  rolledBack: false,
  logFile: null,
};

//启动自检未通过时的中文原因，非null时所有请求都直接失败
let selfCheckError = null;
//处理请求期间置true，避免静默检查把正装进行中的状态覆盖掉
let busy = false;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ensureDirs() {
  for (const dir of [SPOOL_DIR, REQUESTS_DIR, PROCESSED_DIR, LOGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

//所有JSON写入都走这里：先写 .tmp再rename，对方永远不会读到半个文件
function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

//合并写入status，updatedAt每次自动刷新
function writeStatus(patch) {
  status = { ...status, ...patch, updatedAt: Date.now() };
  try {
    writeJsonAtomic(STATUS_FILE, status);
  } catch (err) {
    console.error(`[updater] 写 status.json 失败: ${err.message}`);
  }
  return status;
}

function shortSha(sha) {
  return sha ? String(sha).slice(0, 7) : null;
}

function firstLine(text) {
  const line = String(text || "")
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  return line || "未知错误";
}

function appendLog(logFile, chunk) {
  try {
    fs.appendFileSync(logFile, chunk);
  } catch {
    //日志写不进去也不能影响更新主流程
  }
}

//用于git之类需要拿到输出的短命令
function runCapture(command, args, options = {}) {
  const { cwd = ROOT || undefined, env = process.env, timeoutMs = 0 } = options;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: String(err && err.message), timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs)
        : null;
    const finish = (code, extra) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr: extra ? `${stderr}${extra}` : stderr, timedOut });
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => finish(-1, String(err && err.message)));
    //超时被SIGKILL后close仍会触发，靠done保证只结算一次
    child.on("close", (code) => finish(code === null ? -1 : code));
  });
}

//用于构建与重启：输出实时追加到日志文件，不用execSync一次性拿结果
function runLogged(command, args, options = {}) {
  const { cwd = ROOT || undefined, env = process.env, timeoutMs = 0, logFile } = options;
  const line = `\n$ ${command} ${args.join(" ")}\n`;
  appendLog(logFile, line);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      appendLog(logFile, `[启动失败] ${err && err.message}\n`);
      resolve({ code: -1, timedOut: false });
      return;
    }
    let timedOut = false;
    let done = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            appendLog(logFile, `\n[超时] 超过 ${Math.round(timeoutMs / 1000)} 秒，强制结束\n`);
            child.kill("SIGKILL");
          }, timeoutMs)
        : null;
    const finish = (code, extra) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (extra) appendLog(logFile, extra);
      resolve({ code, timedOut });
    };
    child.stdout.on("data", (chunk) => appendLog(logFile, chunk));
    child.stderr.on("data", (chunk) => appendLog(logFile, chunk));
    child.on("error", (err) => finish(-1, `[启动失败] ${err && err.message}\n`));
    child.on("close", (code) => finish(code === null ? -1 : code));
  });
}

function git(args, timeoutMs = GIT_TIMEOUT_MS) {
  return runCapture("git", args, { cwd: ROOT, env: GIT_ENV, timeoutMs });
}

async function dockerCompose(subArgs, commit, options = {}) {
  //绝不加 -p参数：项目名由 --project-directory推导，才能对上宿主机已有的项目
  const args = [
    "compose",
    "-f",
    path.join(ROOT, "docker-compose.yml"),
    "--project-directory",
    ROOT,
    ...subArgs,
  ];
  //MB_COMMIT同时参与compose插值，构建与重启两条命令都必须带上
  const env = { ...process.env, MB_COMMIT: commit };
  return runLogged("docker", args, { cwd: ROOT, env, ...options });
}

function createLogFile(id) {
  const name = `${id}.log`;
  const full = path.join(LOGS_DIR, name);
  try {
    fs.writeFileSync(full, `[updater] 请求 ${id} 开始处理 ${new Date().toISOString()}\n`, "utf8");
  } catch {
    //日志文件创建失败只影响排查，不阻断流程
  }
  return { full, relative: `logs/${name}` };
}

//当前真正在跑的版本，app.json比仓库HEAD可靠：回滚后HEAD是旧的，跑着的可能还是新的
function readAppCommit() {
  const app = readJson(APP_FILE);
  const commit = String((app && app.commit) || "").trim();
  if (!commit || commit === "unknown") return null;
  return commit;
}

async function resolveCommit(ref) {
  const result = await git(["rev-parse", "--verify", `${ref}^{commit}`]);
  if (result.code !== 0) return null;
  return result.stdout.trim() || null;
}

//4.1检查更新：fetch后比对当前版本与origin/main
async function inspectRemote() {
  const fetched = await git(["fetch", "--prune", "origin", "main"]);
  if (fetched.code !== 0) {
    return {
      error: fetched.timedOut
        ? "拉取远程仓库超时，请检查服务器网络"
        : `拉取远程仓库失败：${firstLine(fetched.stderr)}`,
    };
  }
  const headFull = await resolveCommit("HEAD");
  if (!headFull) return { error: "读取服务器仓库 HEAD 失败" };
  const latestFull = await resolveCommit("origin/main");
  if (!latestFull) return { error: "找不到 origin/main，请检查远程仓库" };

  const appCommit = readAppCommit();
  let currentFull = appCommit ? await resolveCommit(appCommit) : null;
  if (!currentFull) currentFull = headFull;
  //当前版本不是origin/main的祖先说明服务器上有本地提交，强推会丢别人的现场改动
  const ancestor = await git(["merge-base", "--is-ancestor", currentFull, latestFull]);
  if (ancestor.code !== 0) {
    return {
      error: "服务器仓库有本地提交或历史不一致，无法自动更新，请先在服务器上处理",
      currentFull,
      latestFull,
    };
  }
  const behindResult = await git(["rev-list", "--count", `${currentFull}..${latestFull}`]);
  const aheadResult = await git(["rev-list", "--count", `${latestFull}..${currentFull}`]);
  const logResult = await git([
    "log",
    "--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s",
    "--date=short",
    "-n",
    "20",
    `${currentFull}..${latestFull}`,
  ]);
  const commits = [];
  if (logResult.code === 0) {
    for (const line of logResult.stdout.split("\n")) {
      if (!line.trim()) continue;
      const [full, sha, author, date, subject] = line.split("\x1f");
      if (!sha) continue;
      //%x1f做分隔符，commit标题里带空格也不会错位
      commits.push({
        sha: sha.trim(),
        subject: (subject || "").trim(),
        author: (author || "").trim(),
        date: (date || "").trim(),
        full,
      });
    }
  }
  return {
    currentFull,
    current: shortSha(currentFull),
    latestFull,
    latest: shortSha(latestFull),
    behind: Number(behindResult.stdout.trim()) || 0,
    ahead: Number(aheadResult.stdout.trim()) || 0,
    commits: commits.map(({ sha, subject, author, date }) => ({ sha, subject, author, date })),
    checkedAt: Date.now(),
  };
}

//健康检查：2xx/3xx都算健康，先试 /mboard/login再兜底 /login
async function probeUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealthOnce() {
  for (const url of HEALTH_URLS) {
    if (await probeUrl(url)) return url;
  }
  return null;
}

async function waitHealthy(timeoutMs = HEALTH_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const hit = await checkHealthOnce();
    if (hit) return hit;
    await sleep(HEALTH_INTERVAL_MS);
  }
  return null;
}

async function readContainerStartedAt() {
  const result = await runCapture("docker", ["inspect", "-f", "{{.State.StartedAt}}", "mboard"], {
    timeoutMs: 10000,
  });
  if (result.code !== 0) return null;
  return result.stdout.trim() || null;
}

//防呆：up -d之后旧容器可能还在服务，健康检查会立刻通过造成假成功
//所以先确认容器确实重启了，确认不了就只记日志不阻断
async function waitContainerRestart(baseline, logFile) {
  if (!baseline) {
    appendLog(logFile, "[提示] 读不到容器启动时间，跳过重启确认\n");
    return "unknown";
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < RESTART_WAIT_MS) {
    const current = await readContainerStartedAt();
    if (current && current !== baseline) return true;
    await sleep(HEALTH_INTERVAL_MS);
  }
  appendLog(logFile, "[警告] 90 秒内未观察到 mboard 容器重启，继续以健康检查为准\n");
  return false;
}

//请求处理完移到processed，只保留最近20个
function pruneProcessed() {
  try {
    const files = fs
      .readdirSync(PROCESSED_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse();
    for (const name of files.slice(PROCESSED_KEEP)) {
      try {
        fs.unlinkSync(path.join(PROCESSED_DIR, name));
      } catch {
        //删不掉就留着，下次再清
      }
    }
  } catch {
    //processed目录异常不影响主流程
  }
}

function moveToProcessed(sourceName) {
  try {
    fs.renameSync(path.join(REQUESTS_DIR, sourceName), path.join(PROCESSED_DIR, sourceName));
  } catch {
    //移动失败说明文件已被别人处理，忽略即可
  }
  pruneProcessed();
}

//取下一个请求，一次只处理一个，按文件名排序保证先到先处理
//读取后立刻移入processed，避免同一个请求被重复执行
function nextRequest() {
  let names = [];
  try {
    names = fs
      .readdirSync(REQUESTS_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return null;
  }
  for (const name of names) {
    const full = path.join(REQUESTS_DIR, name);
    let isFile = false;
    try {
      isFile = fs.statSync(full).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) continue;
    const data = readJson(full);
    moveToProcessed(name);
    const fallbackId = name.replace(/\.json$/, "");
    return { id: (data && data.id) || fallbackId, data, sourceName: name };
  }
  return null;
}

//倒计时与重建期间不接受新请求，直接把它们挪走忽略
function drainExtraRequests() {
  let names = [];
  try {
    names = fs.readdirSync(REQUESTS_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  for (const name of names) {
    moveToProcessed(name);
  }
}

async function performCheck(requestId, actor) {
  writeStatus({
    phase: "checking",
    message: "正在检查更新…",
    requestId,
    actor: actor || null,
    error: null,
    rolledBack: false,
    deadline: null,
    logFile: null,
  });
  const result = await inspectRemote();
  if (result.error) {
    writeStatus({
      phase: "failed",
      message: "检查更新失败",
      error: result.error,
      current: result.currentFull ? shortSha(result.currentFull) : status.current,
      currentFull: result.currentFull || status.currentFull,
      latest: result.latestFull ? shortSha(result.latestFull) : status.latest,
      latestFull: result.latestFull || status.latestFull,
    });
    return;
  }
  const patch = { ...result };
  if (result.behind > 0) {
    patch.phase = "update_available";
    patch.message = `发现 ${result.behind} 个新提交`;
  } else {
    patch.phase = "up_to_date";
    patch.message = "已是最新版本";
  }
  writeStatus(patch);
}

//回滚：把仓库退回PREV，用PREV重新构建并重启，再走一次健康检查
async function rollback(prevFull, reason, logFile) {
  const prevShort = shortSha(prevFull);
  writeStatus({
    phase: "applying",
    message: "更新失败，正在回滚…",
    error: reason,
    deadline: null,
  });
  appendLog(logFile, `\n[回滚] 原因：${reason}\n`);

  const reset = await git(["reset", "--hard", prevFull]);
  if (reset.code !== 0) {
    writeStatus({
      phase: "failed",
      message: "回滚失败，需要人工介入",
      rolledBack: false,
      error: `${reason}（回滚时 git reset 失败：${firstLine(reset.stderr)}，需要人工介入）`,
      current: prevShort,
      currentFull: prevFull,
    });
    return;
  }

  const build = await dockerCompose(["build", "mboard"], prevFull, {
    logFile,
    timeoutMs: BUILD_TIMEOUT_MS,
  });
  if (build.code !== 0) {
    writeStatus({
      phase: "failed",
      message: "回滚失败，需要人工介入",
      rolledBack: false,
      error: `${reason}（回滚构建失败：已退回 ${prevShort} 但镜像没重建成功，需要人工介入）`,
      current: prevShort,
      currentFull: prevFull,
    });
    return;
  }

  const up = await dockerCompose(["up", "-d", "--no-deps", "mboard"], prevFull, {
    logFile,
    timeoutMs: COMPOSE_TIMEOUT_MS,
  });
  if (up.code !== 0) {
    writeStatus({
      phase: "failed",
      message: "回滚失败，需要人工介入",
      rolledBack: false,
      error: `${reason}（回滚重启失败：${firstLine(`退出码 ${up.code}`)}，需要人工介入）`,
      current: prevShort,
      currentFull: prevFull,
    });
    return;
  }

  const healthy = await waitHealthy();
  if (healthy) {
    writeJsonAtomic(BUILD_FILE, { commit: prevShort, full: prevFull, builtAt: Date.now() });
    appendLog(logFile, `[回滚] 已回滚到 ${prevShort} 并恢复服务\n`);
    writeStatus({
      phase: "failed",
      message: `更新失败，已回滚到 ${prevShort}`,
      rolledBack: true,
      error: reason,
      current: prevShort,
      currentFull: prevFull,
      behind: 0,
      ahead: 0,
      commits: [],
    });
    return;
  }
  writeStatus({
    phase: "failed",
    message: "回滚后服务仍不可用，需要人工介入",
    rolledBack: false,
    error: `${reason}（已退回 ${prevShort} 但健康检查 150 秒内未通过，需要人工介入）`,
    current: prevShort,
    currentFull: prevFull,
  });
}

//4.2执行更新：倒计时 → 体检 → reset → 构建 → 重启 → 健康检查，失败走回滚
async function performUpdate(requestId, request) {
  const requested = Number(request.deadline) || 0;
  //倒计时最长只认60秒，防止请求里带一个离谱的时间戳把队列卡死
  const deadline =
    requested > 0 ? Math.min(requested, Date.now() + 60000) : Date.now() + COUNTDOWN_DEFAULT_MS;
  const log = createLogFile(requestId);
  writeStatus({
    phase: "countdown",
    message: "更新倒计时中，即将开始重建",
    requestId,
    actor: request.actor || null,
    deadline,
    error: null,
    rolledBack: false,
    logFile: log.relative,
  });
  appendLog(log.full, `[updater] 倒计时到 ${new Date(deadline).toISOString()}\n`);

  while (Date.now() < deadline) {
    //倒计时期间来的新请求一律忽略，避免连点触发第二次重建
    drainExtraRequests();
    await sleep(POLL_INTERVAL_MS);
  }

  writeStatus({ phase: "applying", message: "正在拉取代码…", deadline: null });

  //先拿到PREV，后面每一步失败都要靠它回滚
  const prevFull = await resolveCommit("HEAD");
  if (!prevFull) {
    writeStatus({
      phase: "failed",
      message: "读取当前提交失败",
      error: "读取当前提交失败，无法开始更新",
      rolledBack: false,
      deadline: null,
    });
    return;
  }

  const dirty = await git(["status", "--porcelain"]);
  if (dirty.code !== 0) {
    await rollback(prevFull, `无法读取服务器仓库状态：${firstLine(dirty.stderr)}`, log.full);
    return;
  }
  if (dirty.stdout.trim()) {
    //绝不覆盖别人的现场调试，直接失败让管理员先处理
    writeStatus({
      phase: "failed",
      message: "服务器仓库有未提交的改动",
      error: "服务器仓库有未提交的改动，请先在服务器上处理",
      rolledBack: false,
      deadline: null,
    });
    return;
  }

  const fetched = await git(["fetch", "origin", "main"]);
  if (fetched.code !== 0) {
    const reason = fetched.timedOut
      ? "拉取远程仓库超时，请检查服务器网络"
      : `拉取远程仓库失败：${firstLine(fetched.stderr)}`;
    await rollback(prevFull, reason, log.full);
    return;
  }
  const reset = await git(["reset", "--hard", "FETCH_HEAD"]);
  if (reset.code !== 0) {
    await rollback(prevFull, `切换到最新代码失败：${firstLine(reset.stderr)}`, log.full);
    return;
  }

  const newFull = await resolveCommit("HEAD");
  if (!newFull) {
    await rollback(prevFull, "读取新提交失败", log.full);
    return;
  }
  const appCommit = readAppCommit();
  const appFull = appCommit ? await resolveCommit(appCommit) : null;
  if (newFull === prevFull && appFull === newFull) {
    //代码没变且正在跑的就是这版，没必要白白重建一次
    writeStatus({
      phase: "up_to_date",
      message: "已是最新版本",
      current: shortSha(newFull),
      currentFull: newFull,
      behind: 0,
      ahead: 0,
      commits: [],
      deadline: null,
      error: null,
    });
    return;
  }

  writeStatus({
    message: "正在构建镜像…",
    current: shortSha(prevFull),
    currentFull: prevFull,
    latest: shortSha(newFull),
    latestFull: newFull,
  });
  const baseline = await readContainerStartedAt();
  const build = await dockerCompose(["build", "mboard"], newFull, {
    logFile: log.full,
    timeoutMs: BUILD_TIMEOUT_MS,
  });
  if (build.code !== 0) {
    await rollback(prevFull, build.timedOut ? "构建镜像超时" : "构建镜像失败，详见更新日志", log.full);
    return;
  }

  writeStatus({ message: "正在重启服务…" });
  const up = await dockerCompose(["up", "-d", "--no-deps", "mboard"], newFull, {
    logFile: log.full,
    timeoutMs: COMPOSE_TIMEOUT_MS,
  });
  if (up.code !== 0) {
    await rollback(prevFull, `重启服务失败（退出码 ${up.code}）`, log.full);
    return;
  }

  writeStatus({ message: "正在等待服务就绪…" });
  await waitContainerRestart(baseline, log.full);
  const healthy = await waitHealthy();
  if (!healthy) {
    await rollback(prevFull, "新版本健康检查 150 秒内未通过", log.full);
    return;
  }

  writeJsonAtomic(BUILD_FILE, { commit: shortSha(newFull), full: newFull, builtAt: Date.now() });
  appendLog(log.full, `[updater] 更新成功，当前版本 ${shortSha(newFull)}\n`);
  writeStatus({
    phase: "done",
    message: `已更新到 ${shortSha(newFull)}`,
    current: shortSha(newFull),
    currentFull: newFull,
    latest: shortSha(newFull),
    latestFull: newFull,
    behind: 0,
    ahead: 0,
    commits: [],
    deadline: null,
    error: null,
    rolledBack: false,
    checkedAt: Date.now(),
  });
}

async function handleRequest(entry) {
  const requestId = entry.id;
  const request = entry.data;
  if (!request || typeof request !== "object") {
    writeStatus({
      phase: "failed",
      message: "请求文件无法解析",
      requestId,
      error: "请求文件不是合法 JSON，请重新发起",
      deadline: null,
    });
    return;
  }
  if (selfCheckError) {
    writeStatus({
      phase: "failed",
      message: "更新服务不可用",
      requestId,
      actor: request.actor || null,
      error: selfCheckError,
      rolledBack: false,
      deadline: null,
    });
    return;
  }
  if (request.type === "check") {
    await performCheck(requestId, request.actor);
    return;
  }
  if (request.type === "update") {
    await performUpdate(requestId, request);
    return;
  }
  writeStatus({
    phase: "failed",
    message: "请求类型不支持",
    requestId,
    actor: request.actor || null,
    error: `不认识的请求类型：${String(request.type)}`,
    deadline: null,
  });
}

//启动5秒后做一次静默检查，只刷新latest/behind，不改phase
async function silentCheck() {
  if (busy) return;
  const result = await inspectRemote();
  if (result.error) return;
  writeStatus({
    current: result.current,
    currentFull: result.currentFull,
    latest: result.latest,
    latestFull: result.latestFull,
    behind: result.behind,
    ahead: result.ahead,
    commits: result.commits,
    checkedAt: result.checkedAt,
  });
}

//4.4启动自检，任何一项失败都只写error然后继续常驻，不退出进程
async function runSelfCheck() {
  if (!ROOT) {
    return "未配置 MBOARD_ROOT，请在 .env 里加一行 MBOARD_ROOT=<项目的绝对路径>，然后执行 docker compose up -d";
  }
  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    return `服务器上的项目不是 git 仓库（当前 MBOARD_ROOT=${ROOT}），请确认 .env 里的 MBOARD_ROOT 指向项目的绝对路径`;
  }
  if (!fs.existsSync(path.join(ROOT, "docker-compose.yml"))) return "找不到 docker-compose.yml";
  const docker = await runCapture("docker", ["version", "--format", "{{.Server.Version}}"], {
    timeoutMs: 20000,
  });
  if (docker.code !== 0) return "无法连接宿主机 docker，请检查 docker.sock 是否挂载";
  const gitVersion = await runCapture("git", ["--version"], { timeoutMs: 10000 });
  if (gitVersion.code !== 0) return "镜像里缺少 git";
  return null;
}

//心跳必须无条件执行：应用侧靠heartbeat的mtime判断更新服务是否可用
//自检失败也要接着刷，否则页面只会显示“未检测到更新服务”，用户看不到真正的报错
//setInterval不占事件循环，长时间构建期间心跳照样每2秒跳一次
function startHeartbeat() {
  const startedAt = Date.now();
  const beat = () => {
    try {
      writeJsonAtomic(HEARTBEAT_FILE, {
        at: Date.now(),
        pid: process.pid,
        uptime: Date.now() - startedAt,
        phase: status.phase,
        ok: !selfCheckError,
      });
    } catch (err) {
      console.error(`[updater] 写 heartbeat.json 失败: ${err.message}`);
    }
  };
  beat();
  setInterval(beat, HEARTBEAT_INTERVAL_MS);
}

async function requestLoop() {
  //单线程串行：一个请求的完整流程走完才会看下一个，天然满足“同一时间只处理一个”
  for (;;) {
    try {
      const entry = nextRequest();
      if (!entry) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      busy = true;
      await handleRequest(entry);
    } catch (err) {
      //兜底：任何未预期异常都不许让常驻进程退出
      console.error(`[updater] 处理请求时出现未预期异常: ${err && err.stack}`);
      try {
        writeStatus({
          phase: "failed",
          message: "更新服务内部错误",
          error: `更新服务内部错误：${(err && err.message) || "未知"}`,
          deadline: null,
        });
      } catch {
        //status写失败也就只能记日志了
      }
    } finally {
      busy = false;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main() {
  ensureDirs();
  //先起心跳再自检：自检要等docker version，慢的话页面会误判更新服务不存在
  startHeartbeat();
  writeStatus({
    phase: "idle",
    message: "更新服务启动中…",
    error: null,
    rolledBack: false,
    deadline: null,
    current: shortSha(readAppCommit()),
    currentFull: readAppCommit(),
  });

  selfCheckError = await runSelfCheck();
  writeStatus({
    phase: "idle",
    message: selfCheckError ? "更新服务不可用" : "更新服务已就绪",
    error: selfCheckError,
    rolledBack: false,
    deadline: null,
  });
  if (!selfCheckError) {
    setTimeout(() => {
      silentCheck().catch(() => {
        //启动时的静默检查失败无所谓，离线不影响使用
      });
    }, 5000);
  }
  await requestLoop();
}

main().catch((err) => {
  console.error(`[updater] 启动失败: ${err && err.stack}`);
  try {
    writeStatus({
      phase: "failed",
      message: "更新服务启动失败",
      error: `更新服务启动失败：${(err && err.message) || "未知"}`,
    });
  } catch {
    //连状态都写不了，只能退出让docker重启
  }
  process.exit(1);
});
