import type { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  sessionMaxAgeDays,
  signSession,
  type SessionUser,
} from "./token";

// 写入/刷新会话 Cookie，登录与修改资料后复用
export async function applySessionCookie(response: NextResponse, user: SessionUser) {
  const token = await signSession(user);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: sessionMaxAgeDays() * 24 * 60 * 60,
  });
}

// 清除会话 Cookie
export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 0,
  });
}
