// E2E: two browser tabs editing the same canvas, verify realtime propagation
// usage: node scripts/collab-e2e.mjs <canvasId>
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((item) => fs.existsSync(item));
if (!CHROME) {
  console.error("Chrome not found");
  process.exit(1);
}

const canvasId = process.argv[2];
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const loginUser = process.env.MB_USER || "maxy";
const loginPass = process.env.MB_PASS || "123456";
const debugPort = 9334;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mb-e2e-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--window-size=1440,900",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

async function waitJson(url) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("chrome devtools timeout");
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url, { perMessageDeflate: false });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new Cdp(socket);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
    }
    return result.result?.value;
  }
}

async function openTab(url) {
  const target = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" }
  ).then((response) => response.json());
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return { cdp, targetId: target.id };
}

let tabA;
let tabB;
let testId;
const results = [];
const check = (label, passed, detail = "") => {
  results.push({ label, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
};

try {
  await waitJson(`http://127.0.0.1:${debugPort}/json/version`);

  // 登录并建立两个独立标签页
  const loginTab = await openTab(`${baseUrl}/login`);
  for (let i = 0; i < 120; i += 1) {
    const origin = await loginTab.cdp.evaluate(`location.origin`);
    if (origin === baseUrl) break;
    await sleep(250);
  }
  await sleep(800);
  const status = await loginTab.cdp.evaluate(
    `fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:${JSON.stringify(loginUser)},password:${JSON.stringify(loginPass)}})}).then(r=>r.status)`
  );
  check("login", status === 200, `status=${status}`);
  await fetch(`http://127.0.0.1:${debugPort}/json/close/${loginTab.targetId}`);

  const canvasUrl = `${baseUrl}/canvas/${canvasId}`;
  tabA = await openTab(canvasUrl);
  tabB = await openTab(canvasUrl);

  const waitEditor = async (tab, label) => {
    for (let i = 0; i < 160; i += 1) {
      const ready = await tab.cdp.evaluate(
        `Boolean(window.__MB_EDITOR__ && window.__MB_EDITOR__.api && window.__MB_EDITOR__.provider && window.__MB_EDITOR__.provider.status === 'connected')`
      );
      if (ready) return true;
      await sleep(250);
    }
    throw new Error(`${label} editor not ready`);
  };

  await waitEditor(tabA, "A");
  await waitEditor(tabB, "B");
  check("both editors connected", true);

  const baseline = await tabA.cdp.evaluate(
    `window.__MB_EDITOR__.api.getSceneElements().length`
  );
  check("scene loaded", baseline > 0, `elements=${baseline}`);

  // A 新增一个矩形，验证 B 实时收到
  testId = `e2e-${Date.now()}`;
  const added = await tabA.cdp.evaluate(`(() => {
    const api = window.__MB_EDITOR__.api;
    const elements = api.getSceneElements();
    const source = elements.find((element) => element.type === 'rectangle') || elements[0];
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = ${JSON.stringify(testId)};
    clone.x = (source.x || 0) + 420;
    clone.y = (source.y || 0) + 260;
    clone.version = 1;
    clone.versionNonce = Math.floor(Math.random() * 100000);
    clone.boundElements = null;
    clone.customData = undefined;
    api.updateScene({ elements: [...elements, clone], captureUpdate: 'IMMEDIATELY' });
    return api.getSceneElements().some((element) => element.id === ${JSON.stringify(testId)});
  })()`);
  check("tab A added element", added === true);

  let seenByB = false;
  for (let i = 0; i < 40; i += 1) {
    seenByB = await tabB.cdp.evaluate(
      `window.__MB_EDITOR__.api.getSceneElements().some((element) => element.id === ${JSON.stringify(testId)})`
    );
    if (seenByB) break;
    await sleep(150);
  }
  check("tab B receives element in realtime", seenByB);

  // A 修改坐标，B 同步更新
  if (seenByB) {
    await tabA.cdp.evaluate(`(() => {
      const api = window.__MB_EDITOR__.api;
      const elements = api.getSceneElements().map((element) =>
        element.id === ${JSON.stringify(testId)}
          ? { ...element, x: element.x + 111, version: element.version + 1, versionNonce: Math.floor(Math.random() * 100000) }
          : element
      );
      api.updateScene({ elements, captureUpdate: 'IMMEDIATELY' });
    })()`);

    let moved = false;
    for (let i = 0; i < 40; i += 1) {
      moved = await tabB.cdp.evaluate(`(() => {
        const element = window.__MB_EDITOR__.api.getSceneElements().find((item) => item.id === ${JSON.stringify(testId)});
        return Boolean(element);
      })()`);
      if (moved) break;
      await sleep(150);
    }
    check("tab B stays in sync after update", moved);
  }

  // 清理测试元素
  await tabA.cdp.evaluate(`(() => {
    const api = window.__MB_EDITOR__.api;
    const elements = api.getSceneElements().filter((element) => element.id !== ${JSON.stringify(testId)});
    api.updateScene({ elements, captureUpdate: 'IMMEDIATELY' });
  })()`);
  await sleep(1800);

  const cleanupSeen = await tabB.cdp.evaluate(
    `!window.__MB_EDITOR__.api.getSceneElements().some((element) => element.id === ${JSON.stringify(testId)})`
  );
  check("test element removed from both tabs", cleanupSeen);

  const shot = await tabB.cdp.send("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "data", "shot-collab.png"), Buffer.from(shot.data, "base64"));
} catch (error) {
  console.error("e2e error:", error);
  results.push({ label: "e2e", passed: false });
  process.exitCode = 1;
} finally {
  for (const tab of [tabA, tabB]) {
    if (!tab) continue;
    try {
      await fetch(`http://127.0.0.1:${debugPort}/json/close/${tab.targetId}`);
    } catch {
      /* ignore */
    }
    tab.cdp.socket.close();
  }
  chrome.kill();
  await sleep(700);
  fs.rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((item) => !item.passed);
console.log(`\nresult: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
