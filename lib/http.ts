import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/token";

// 统一 JSON 响应
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function unauthorized() {
  return fail("未登录或登录已过期", 401);
}

export function notFound(message = "资源不存在") {
  return fail(message, 404);
}

export function serverError(error: unknown) {
  console.error("[api]", error);
  const message = error instanceof Error ? error.message : "服务器开小差了";
  return fail(message, 500);
}

// API 鉴权包装：未登录直接返回 401
export async function withSession<T>(
  handler: (session: SessionUser) => Promise<T>
): Promise<T | NextResponse> {
  const session = await getSession();
  if (!session) return unauthorized();
  return handler(session);
}

// 读取并校验 JSON 请求体
export async function readJson<T>(
  request: Request,
  parse: (value: unknown) => { success: true; data: T } | { success: false; error: string }
): Promise<{ data: T } | { error: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: fail("请求体不是合法的 JSON") };
  }

  const result = parse(body);
  if (!result.success) {
    return { error: fail(result.error) };
  }
  return { data: result.data };
}
