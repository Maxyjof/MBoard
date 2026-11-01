// 更新流程端到端验证：配合 scripts/mock-updater.mjs 使用，不需要 docker
// 用法：
//   1) 另开终端 node scripts/mock-updater.mjs
//   2) node scripts/update-e2e.mjs [输出目录]
// 它会登录、点检查更新、点立即更新、确认倒计时、等构建，逐步截图并报告控制台错误

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

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000/mboard";
const outputDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), "data", "screenshots");
const loginUser = process.env.MB_USER || "maxy";
const loginPass = process.env.MB_PASS || "123456";
const port = 9334;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-update-"));

fs.mkdirSync(outputDir, { recursive: true });

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
      // 继续等
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
    this.logs = [];
  }

  static async connect(url) {
    const socket = new WebSocket(url, { perMessageDeflate: false });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const cdp = new Cdp(socket);

    // 命令响应按 id 回填，事件交给日志收集
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (message.id && cdp.pending.has(message.id)) {
        const { resolve, reject } = cdp.pending.get(message.id);
        cdp.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }

      if (message.method) cdp.handleEvent(message);
    });

    return cdp;
  }

  handleEvent(message) {
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      this.logs.push(`[exception] ${detail.exception?.description || detail.text}`);
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      this.logs.push(`[log] ${message.params.entry.text}`);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      this.logs.push(`[console] ${message.params.args.map((arg) => arg.value ?? arg.description).join(" ")}`);
    }
    // 把失败的请求 URL 也打出来，光看 404 不知道是哪个资源
    if (message.method === "Network.responseReceived") {
      const { response, type } = message.params;
      if (response.status >= 400) this.logs.push(`[http ${response.status}] ${type} ${response.url}`);
    }
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
    return result.result?.value;
  }

  async shot(name) {
    const data = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = path.join(outputDir, name);
    fs.writeFileSync(file, Buffer.from(data.data, "base64"));
    console.log(`  📸 ${file}`);
    return file;
  }
}

let cdp;
let targetId;
const failures = [];

function expect(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    console.error(`  ❌ ${message}`);
    failures.push(message);
  }
}

// 按可见文字点按钮
async function clickByText(text) {
  return cdp.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll('button'));
    const hit = nodes.find((node) => (node.innerText || '').includes(${JSON.stringify(text)}));
    if (!hit) return false;
    hit.click();
    return true;
  })()`);
}

async function waitFor(expression, timeoutMs, stepMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cdp.evaluate(expression)) return true;
    await sleep(stepMs);
  }
  return false;
}

const bodyContains = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;

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

  console.log("1. 登录并进入看板页");
  await cdp.send("Page.navigate", { url: `${baseUrl}/login` });
  await sleep(1500);
  const loginStatus = await cdp.evaluate(
    `fetch('${baseUrl}/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:${JSON.stringify(loginUser)},password:${JSON.stringify(loginPass)}})}).then(r=>r.status)`
  );
  expect(loginStatus === 200, `登录返回 ${loginStatus}`);

  await cdp.send("Page.navigate", { url: `${baseUrl}/boards` });
  await sleep(3500);
  // 预先塞一个旧版本号，用来验证「更新后自动提示新版本」
  await cdp.evaluate(`localStorage.setItem('mb-app-commit','0000000')`);

  console.log("2. 侧边栏应该出现检查更新入口");
  expect(await cdp.evaluate(bodyContains("检查更新")), "侧边栏渲染出「检查更新」按钮");
  expect(await cdp.evaluate(`Boolean(document.querySelector('a[href="/mboard/boards"]'))`), "工作台正常渲染");
  await cdp.shot("01-sidebar.png");

  console.log("3. 点击检查更新，应列出新提交");
  expect(await clickByText("检查更新"), "点到了检查更新按钮");
  const sawCommits = await waitFor(bodyContains("个新提交"), 15000);
  expect(sawCommits, "弹窗显示发现新提交");
  await cdp.shot("02-check-result.png");

  console.log("4. 点击立即更新，应弹出全员倒计时");
  expect(await clickByText("立即更新到"), "点到了立即更新按钮");
  const sawCountdown = await waitFor(bodyContains("网站即将强制更新"), 15000);
  expect(sawCountdown, "倒计时弹窗出现");
  await cdp.shot("03-countdown.png");

  console.log("5. 点确定应回到主界面");
  expect(await clickByText("确定并回到主界面"), "点到了确定按钮");
  await sleep(1200);
  const pathname = await cdp.evaluate("window.location.pathname");
  expect(pathname === "/mboard/boards", `当前路由是 ${pathname}`);
  await cdp.shot("04-acknowledged.png");

  console.log("6. 倒计时结束后应进入更新遮罩");
  const sawApplying = await waitFor(bodyContains("正在更新网站"), 30000);
  expect(sawApplying, "出现更新中遮罩");
  await cdp.shot("05-applying.png");

  console.log("7. 等待更新结果");
  const expectFail = process.env.EXPECT_FAIL === "1";
  if (expectFail) {
    // 配合 MOCK_FAIL=1 跑，验证失败后自动回滚的提示
    const sawFailed = await waitFor(bodyContains("更新失败"), 45000);
    expect(sawFailed, "出现更新失败弹窗");
    const rolledBack = await waitFor(bodyContains("已回滚并重启"), 15000);
    expect(rolledBack, "提示已自动回滚并重启");
    await cdp.shot("06-failed.png");
  } else {
    const reloaded = await waitFor(bodyContains("已更新到"), 45000);
    expect(reloaded, "刷新后出现「已更新到」提示");
    await sleep(2500);
    await cdp.shot("06-updated.png");
  }

  if (cdp.logs.length) {
    console.log("--- 控制台错误 ---");
    for (const line of cdp.logs.slice(0, 30)) console.log(line);
  } else {
    console.log("--- 没有控制台错误 ---");
  }
} catch (error) {
  console.error("验证失败:", error);
  failures.push(String(error));
  process.exitCode = 1;
} finally {
  try {
    if (targetId) await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
  } catch {
    // 忽略
  }
  cdp?.socket.close();
  chrome.kill();
  await sleep(600);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  if (failures.length) {
    console.error(`\n共 ${failures.length} 项未通过`);
    process.exitCode = 1;
  } else {
    console.log("\n全部通过");
  }
}
