// 多用户光标 E2E：两个独立浏览器会话分别登录不同账号，验证对方能看到光标与用户名
// usage: node scripts/cursor-e2e.mjs <canvasId>
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
const userA = process.env.MB_USER_A || "maxy";
const userB = process.env.MB_USER_B || "tannami";
const passA = process.env.MB_PASS_A || "123456";
const passB = process.env.MB_PASS_B || "123456";
const expectA = process.env.EXPECT_A || "Maxy";
const expectB = process.env.EXPECT_B || "Tannami";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browsers = [];
const results = [];
const check = (label, passed, detail = "") => {
  results.push({ label, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
};

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

async function launch(port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `mb-cursor-${port}-`));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--window-size=1440,900",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch {
      /* retry */
    }
    await sleep(250);
  }

  const entry = { chrome, profile, port };
  browsers.push(entry);
  return entry;
}

async function openPage(port, url) {
  const target = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
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

async function waitFor(fn, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await sleep(250);
  }
  throw new Error(`timeout: ${label}`);
}

async function loginAndOpenCanvas(port, username, password) {
  const page = await openPage(port, `${baseUrl}/login`);
  await waitFor(
    async () => (await page.cdp.evaluate("location.origin")) === baseUrl,
    30000,
    "login page"
  );
  const status = await page.cdp.evaluate(
    `fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:${JSON.stringify(
      username
    )},password:${JSON.stringify(password)}})}).then(r=>r.status)`
  );
  if (status !== 200) throw new Error(`${username} login failed: ${status}`);

  await page.cdp.send("Page.navigate", { url: `${baseUrl}/canvas/${canvasId}` });
  await waitFor(
    async () =>
      Boolean(
        await page.cdp.evaluate(
          `window.__MB_EDITOR__ && window.__MB_EDITOR__.provider && window.__MB_EDITOR__.provider.status === 'connected'`
        )
      ),
    90000,
    `${username} editor`
  );
  return page;
}

try {
  const browserA = await launch(9345);
  const browserB = await launch(9346);

  const a = await loginAndOpenCanvas(browserA.port, userA, passA);
  const b = await loginAndOpenCanvas(browserB.port, userB, passB);
  check("两个账号分别登录成功", true);

  // A 移动鼠标，B 应该看到 A 的光标与名字
  for (const [x, y] of [
    [520, 380],
    [560, 410],
    [600, 430],
  ]) {
    await a.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
      pointerType: "mouse",
    });
    await sleep(160);
  }

  let remoteForB = [];
  await waitFor(
    async () => {
      remoteForB = await b.cdp.evaluate(`(() => {
        const map = window.__MB_EDITOR__.api.getAppState().collaborators;
        return [...map.values()].map((c) => ({ id: c.id, username: c.username, pointer: c.pointer }));
      })()`);
      return Array.isArray(remoteForB) && remoteForB.some((item) => item.username === expectA);
    },
    15000,
    "B sees A cursor"
  ).catch(() => false);

  const maxyCursor = remoteForB.find((item) => item.username === expectA);
  check("B 看到 A 的协作光标", Boolean(maxyCursor), JSON.stringify(maxyCursor || null));
  check(
    "A 的光标带有用户名",
    maxyCursor?.username === expectA,
    maxyCursor?.username || "missing"
  );
  check(
    "光标坐标已同步",
    Boolean(maxyCursor?.pointer && Number.isFinite(maxyCursor.pointer.x)),
    JSON.stringify(maxyCursor?.pointer || null)
  );

  // B 移动鼠标，A 应该看到 Tannami
  for (const [x, y] of [
    [760, 500],
    [800, 520],
  ]) {
    await b.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons: 0,
      pointerType: "mouse",
    });
    await sleep(160);
  }

  let remoteForA = [];
  await waitFor(
    async () => {
      remoteForA = await a.cdp.evaluate(`(() => {
        const map = window.__MB_EDITOR__.api.getAppState().collaborators;
        return [...map.values()].map((c) => ({ id: c.id, username: c.username }));
      })()`);
      return Array.isArray(remoteForA) && remoteForA.some((item) => item.username === expectB);
    },
    15000,
    "A sees B cursor"
  ).catch(() => false);
  check(
    `A 看到 B 的协作光标（${expectB}）`,
    remoteForA.some((item) => item.username === expectB),
    JSON.stringify(remoteForA)
  );

  // 截图 B，画面里应出现 Maxy 的光标与名字
  const shot = await b.cdp.send("Page.captureScreenshot", { format: "png" });
  const output = path.join(process.cwd(), "data", "shot-cursor.png");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.from(shot.data, "base64"));
  console.log("screenshot:", output);
} catch (error) {
  console.error("cursor e2e error:", error);
  results.push({ label: "cursor e2e", passed: false });
  process.exitCode = 1;
} finally {
  for (const browser of browsers) {
    try {
      browser.chrome.kill();
    } catch {
      /* ignore */
    }
  }
  // 给 Chrome 一点时间释放文件句柄，清理失败不影响测试结论
  await sleep(1200);
  for (const browser of browsers) {
    try {
      fs.rmSync(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      console.warn(`临时目录未清理: ${browser.profile}`);
    }
  }
}

const failed = results.filter((item) => !item.passed);
console.log(`\nresult: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
