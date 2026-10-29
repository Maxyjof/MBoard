// 开发态预热：登录后把主要路由先访问一遍，触发 Next dev 的按需编译
// 用法：先 npm run dev，另开终端执行 npm run warm
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const username = process.env.MB_USER || "maxy";
const password = process.env.MB_PASS || "123456";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const cookie = (response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie") || "")
    .split(";")[0];
  if (!response.ok || !cookie) {
    throw new Error(`登录失败（${response.status}），请确认 ${baseUrl} 已启动`);
  }
  return cookie;
}

async function getJson(path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

async function warm(path, cookie) {
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { cookie },
      redirect: "manual",
    });
    const elapsed = Date.now() - started;
    console.log(`${response.status === 200 ? "OK " : "WARN"} ${path}  ${elapsed}ms`);
  } catch (error) {
    console.log(`FAIL ${path}  ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  const started = Date.now();
  console.log(`预热 ${baseUrl}`);

  const cookie = await login();
  const [boards, canvases] = await Promise.all([
    getJson("/api/boards", cookie),
    getJson("/api/canvases", cookie),
  ]);

  const paths = ["/boards", "/canvases", "/my-tasks", "/settings"];
  if (boards.boards?.[0]?.id) paths.push(`/boards/${boards.boards[0].id}`);
  if (canvases.canvases?.[0]?.id) paths.push(`/canvas/${canvases.canvases[0].id}`);
  paths.push("/api/members", "/api/documents?q=", "/api/boards");

  for (const path of paths) {
    await warm(path, cookie);
    await sleep(80);
  }

  console.log(`完成，用时 ${Date.now() - started}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
