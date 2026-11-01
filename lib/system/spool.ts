import fs from "node:fs";
import path from "node:path";
import packageJson from "../../package.json";

// 应用与更新服务之间的唯一通道
// 应用这边只做两件事：往 requests/ 丢请求、从 spool 里读状态
// 真正执行 git 和 docker 的是独立的 mboard-updater 容器，协议见 docs/UPDATE.md

export type UpdatePhase =
  | "idle"
  | "checking"
  | "update_available"
  | "up_to_date"
  | "countdown"
  | "applying"
  | "failed"
  | "done";

export type UpdateCommit = {
  sha: string;
  subject: string;
  author: string;
  date: string;
};

export type UpdateStatus = {
  schema: number;
  phase: UpdatePhase;
  message: string;
  requestId: string | null;
  actor: string | null;
  current: string | null;
  currentFull: string | null;
  latest: string | null;
  latestFull: string | null;
  behind: number;
  ahead: number;
  commits: UpdateCommit[];
  deadline: number | null;
  checkedAt: number | null;
  updatedAt: number | null;
  error: string | null;
  rolledBack: boolean;
  logFile: string | null;
};

export type AppInfo = {
  commit: string;
  full: string;
  version: string;
  bootedAt: number;
  pid: number;
};

export type BuildInfo = {
  commit: string;
  full: string;
  builtAt: number;
};

export type UpdateRequestType = "check" | "update";

export type UpdateRequest = {
  id: string;
  type: UpdateRequestType;
  actor: string;
  deadline: number | null;
  createdAt: number;
};

export type UpdateSnapshot = {
  app: {
    version: string;
    commit: string;
    shortCommit: string;
    builtAt: number | null;
  };
  updater: {
    available: boolean;
    alive: boolean;
    error: string | null;
  };
  update: {
    phase: UpdatePhase;
    message: string;
    active: boolean;
    deadline: number | null;
    current: string | null;
    latest: string | null;
    behind: number;
    commits: UpdateCommit[];
    error: string | null;
    rolledBack: boolean;
    checkedAt: number | null;
    actor: string | null;
    logTail: string | null;
  };
};

const DEFAULT_SPOOL_DIR = path.join("data", "update");
const HEARTBEAT_FRESH_MS = 15_000;
const ACTIVE_PHASES: UpdatePhase[] = ["countdown", "applying"];
const VALID_PHASES: UpdatePhase[] = [
  "idle",
  "checking",
  "update_available",
  "up_to_date",
  "countdown",
  "applying",
  "failed",
  "done",
];

// spool 目录：容器里是 /app/data/update，本地开发是 ./data/update
export function spoolDir() {
  const configured = process.env.UPDATE_SPOOL_DIR;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.join(process.cwd(), DEFAULT_SPOOL_DIR);
}

function spoolPath(...segments: string[]) {
  return path.join(spoolDir(), ...segments);
}

export function ensureSpool() {
  try {
    fs.mkdirSync(spoolPath("requests"), { recursive: true });
    fs.mkdirSync(spoolPath("requests", "processed"), { recursive: true });
    fs.mkdirSync(spoolPath("logs"), { recursive: true });
    return true;
  } catch (error) {
    console.error("[system] 无法创建更新目录", error);
    return false;
  }
}

function readJson<T>(file: string): T | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    // 文件不存在、写了一半、内容损坏都当作没有
    return null;
  }
}

// 原子写入：先写临时文件再改名，避免更新容器读到半个 JSON
function writeJson(file: string, data: unknown) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function normalizeStatus(raw: Partial<UpdateStatus> | null): UpdateStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const phase = VALID_PHASES.includes(raw.phase as UpdatePhase) ? (raw.phase as UpdatePhase) : "idle";
  return {
    schema: typeof raw.schema === "number" ? raw.schema : 1,
    phase,
    message: typeof raw.message === "string" ? raw.message : "",
    requestId: raw.requestId ?? null,
    actor: raw.actor ?? null,
    current: raw.current ?? null,
    currentFull: raw.currentFull ?? null,
    latest: raw.latest ?? null,
    latestFull: raw.latestFull ?? null,
    behind: typeof raw.behind === "number" ? raw.behind : 0,
    ahead: typeof raw.ahead === "number" ? raw.ahead : 0,
    commits: Array.isArray(raw.commits) ? raw.commits.slice(0, 20) : [],
    deadline: typeof raw.deadline === "number" ? raw.deadline : null,
    checkedAt: typeof raw.checkedAt === "number" ? raw.checkedAt : null,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : null,
    error: typeof raw.error === "string" && raw.error ? raw.error : null,
    rolledBack: raw.rolledBack === true,
    logFile: typeof raw.logFile === "string" ? raw.logFile : null,
  };
}

export function readStatus(): UpdateStatus | null {
  return normalizeStatus(readJson<Partial<UpdateStatus>>(spoolPath("status.json")));
}

export function readBuildInfo(): BuildInfo | null {
  const raw = readJson<Partial<BuildInfo>>(spoolPath("build.json"));
  if (!raw || typeof raw.commit !== "string") return null;
  return {
    commit: raw.commit,
    full: typeof raw.full === "string" ? raw.full : raw.commit,
    builtAt: typeof raw.builtAt === "number" ? raw.builtAt : 0,
  };
}

// 心跳文件的 mtime 距今多少毫秒，读不到返回 null
export function heartbeatAge(): number | null {
  try {
    return Date.now() - fs.statSync(spoolPath("heartbeat.json")).mtimeMs;
  } catch {
    return null;
  }
}

export function updaterAvailable() {
  return fs.existsSync(spoolPath("heartbeat.json")) || fs.existsSync(spoolPath("status.json"));
}

function shortCommit(value: string | null | undefined) {
  if (!value) return "unknown";
  return value.length > 7 ? value.slice(0, 7) : value;
}

// 应用版本号：镜像构建时用 MB_COMMIT 烧进去，拿不到就当作未知
function appCommit() {
  const value = (process.env.MB_COMMIT || "").trim();
  if (!value || value === "unknown" || value === "dev") return "unknown";
  return value;
}

const APP_INFO_KEY = "__mbAppInfoWritten";

// 每个进程启动后写一次 app.json，让更新服务知道现在真正跑的是哪个提交
function ensureAppInfo(): AppInfo {
  const store = globalThis as Record<string, unknown>;
  const cached = store[APP_INFO_KEY];
  if (cached && typeof cached === "object") return cached as AppInfo;

  const commit = appCommit();
  const info: AppInfo = {
    commit,
    full: commit,
    version: packageJson.version,
    bootedAt: Date.now(),
    pid: process.pid,
  };

  if (!ensureSpool()) return info;

  try {
    writeJson(spoolPath("app.json"), info);
    store[APP_INFO_KEY] = info;
  } catch (error) {
    // 写不进去就让更新服务回退到仓库 HEAD，不影响页面使用
    console.error("[system] 写入 app.json 失败", error);
  }
  return info;
}

export function readAppInfo(): AppInfo {
  return ensureAppInfo();
}

// 当前构建的版本信息，服务端组件直接用它渲染版本号
export function appVersion() {
  const commit = appCommit();
  return {
    version: packageJson.version,
    commit,
    shortCommit: shortCommit(commit),
  };
}

// 写一个请求文件，返回请求 id
export function writeRequest(
  type: UpdateRequestType,
  actor: string,
  deadline: number | null = null
): UpdateRequest {
  if (!ensureSpool()) throw new Error("更新目录不可写，请检查 data/update 挂载");

  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const request: UpdateRequest = {
    id,
    type,
    actor,
    deadline,
    createdAt: Date.now(),
  };
  writeJson(spoolPath("requests", `${id}.json`), request);
  return request;
}

// 读日志尾部，更新中或失败时给页面看进度和报错
export function readLogTail(logFile: string | null, maxLines = 40, maxBytes = 6000): string | null {
  if (!logFile) return null;
  const file = spoolPath(...logFile.split("/"));
  if (!path.resolve(file).startsWith(path.resolve(spoolDir()))) return null;

  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
    } finally {
      fs.closeSync(fd);
    }
    const lines = buffer.toString("utf8").split(/\r?\n/).filter((line) => line.trim());
    return lines.slice(-maxLines).join("\n");
  } catch {
    return null;
  }
}

// 组装给页面用的状态快照，接口层直接返回它
export function buildSnapshot(): UpdateSnapshot {
  const app = ensureAppInfo();
  const status = readStatus();
  const build = readBuildInfo();
  const age = heartbeatAge();
  const available = updaterAvailable();
  const alive = age !== null && age <= HEARTBEAT_FRESH_MS;
  const phase = status?.phase || "idle";
  const active = ACTIVE_PHASES.includes(phase);

  return {
    app: {
      version: app.version,
      commit: app.commit,
      shortCommit: shortCommit(app.commit),
      builtAt: build?.builtAt || null,
    },
    updater: {
      available,
      alive,
      error: status && phase === "idle" ? status.error : null,
    },
    update: {
      phase,
      message: status?.message || "",
      active,
      deadline: status?.deadline ?? null,
      current: status?.current ?? null,
      latest: status?.latest ?? null,
      behind: status?.behind ?? 0,
      commits: status?.commits ?? [],
      error: status?.error ?? null,
      rolledBack: status?.rolledBack ?? false,
      checkedAt: status?.checkedAt ?? null,
      actor: status?.actor ?? null,
      logTail: active || phase === "failed" ? readLogTail(status?.logFile ?? null) : null,
    },
  };
}

export function isBusyPhase(phase: UpdatePhase) {
  return ACTIVE_PHASES.includes(phase);
}

// 等待更新服务处理完指定请求，超时返回 null
export async function waitForRequest(
  requestId: string,
  timeoutMs: number,
  intervalMs = 400
): Promise<UpdateStatus | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = readStatus();
    if (status && status.requestId === requestId && status.phase !== "checking") return status;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}
