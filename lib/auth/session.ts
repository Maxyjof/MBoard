import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession, type SessionUser } from "./token";

// 读取当前请求的登录用户（仅服务端可用）
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

// 服务端页面要求必须登录，未登录时由 middleware 兜底，这里做类型收窄
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}
