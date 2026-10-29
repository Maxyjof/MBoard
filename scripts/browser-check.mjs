// 开发用无头浏览器检查脚本：启动本机 Chrome，登录后截图并输出控制台错误
// 用法: node scripts/browser-check.mjs /canvas/<id> out.png
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : "",
].filter(Boolean);

const chromePath = CHROME_PATHS.find((item) => fs.existsSync(item));
if (!chromePath) {
  console.error("未找到 Chrome");
  process.exit(1);
}

const targetPath = process.argv[2] || "/boards";
const outputPath = process.argv[3] || path.join(process.cwd(), "data", "shot.png");
const skipLogin = process.argv.includes("--no-login");
const waitMs = Number(process.argv.find((arg) => arg.startsWith("--wait="))?.split("=")[1] || 9000);
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const port = 9333;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-chrome-"));

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--window-size=1440,900",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // 继续等待
    }
    await sleep(250);
  }
  throw new Error("等待 Chrome 调试端口超时");
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }

  static async connect(url) {
    const socket = new WebSocket(url, { perMessageDeflate: false });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const cdp = new Cdp(socket);
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && cdp.pending.has(message.id)) {
        const { resolve, reject } = cdp.pending.get(message.id);
        cdp.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method) cdp.events.push(message);
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

const logs = [];
let cdp;
let targetId;

try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  targetId = created.id;

  cdp = await Cdp.connect(created.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  cdp.socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      logs.push(`[exception] ${detail.exception?.description || detail.text}`);
    }
    if (message.method === "Log.entryAdded") {
      const entry = message.params.entry;
      if (entry.level === "error") logs.push(`[log] ${entry.text}`);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      logs.push(`[console] ${message.params.args.map((arg) => arg.value ?? arg.description).join(" ")}`);
    }
  });

  const waitLoad = async () => {
    await sleep(1200);
  };

  await cdp.send("Page.navigate", { url: `${baseUrl}/login` });
  await waitLoad();

  if (!skipLogin) {
    // 通过页面内 fetch 登录，拿到 HttpOnly Cookie
    const login = await cdp.send("Runtime.evaluate", {
      expression: `fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})}).then(r=>r.status)`,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log("login status:", login.result?.value);
  }

  if (process.argv.includes("--dark")) {
    await cdp.send("Runtime.evaluate", {
      expression: `localStorage.setItem('mb-theme','dark')`,
    });
  }

  await cdp.send("Page.navigate", { url: `${baseUrl}${targetPath}` });
  await sleep(waitMs);

  const probe = await cdp.send("Runtime.evaluate", {
    expression: `(() => ({
      title: document.title,
      bodyText: document.body.innerText.slice(0, 300),
      canvases: document.querySelectorAll('.excalidraw canvas').length,
      hasApp: Boolean(document.querySelector('.excalidraw')),
      buttons: document.querySelectorAll('button').length,
    }))()`,
    returnByValue: true,
  });
  console.log("probe:", JSON.stringify(probe.result?.value, null, 2));

  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
  console.log("screenshot:", outputPath);

  if (logs.length) {
    console.log("--- errors ---");
    for (const line of logs.slice(0, 40)) console.log(line);
  } else {
    console.log("--- no console errors ---");
  }
} catch (error) {
  console.error("检查失败:", error);
  process.exitCode = 1;
} finally {
  try {
    if (targetId) {
      await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
    }
  } catch {
    // 忽略
  }
  cdp?.socket.close();
  chrome.kill();
  await sleep(600);
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
