import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/auth/profile";
import { applySessionCookie } from "@/lib/auth/cookie";

const BodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

// 简单的内存限流：避免登录接口被暴力尝试
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0] : request.headers.get("x-real-ip")) || "local";
}

function takeAttempt(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= MAX_ATTEMPTS) return false;
  bucket.count += 1;
  return true;
}

export async function POST(request: Request) {
  const key = clientKey(request);

  if (!takeAttempt(key)) {
    return NextResponse.json({ error: "尝试次数过多，请稍后再试" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "请填写用户名和密码" }, { status: 400 });
  }

  let account: Awaited<ReturnType<typeof authenticate>>;
  try {
    account = await authenticate(parsed.data.username, parsed.data.password);
  } catch (error) {
    console.error("[login]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "账号配置读取失败" },
      { status: 500 }
    );
  }

  if (!account) {
    return NextResponse.json({ error: "用户名或密码不正确" }, { status: 401 });
  }

  buckets.delete(key);

  const response = NextResponse.json({ user: account });
  await applySessionCookie(response, account);
  return response;
}
