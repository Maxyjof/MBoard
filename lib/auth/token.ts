import { SignJWT, jwtVerify } from "jose";

// 会话 Cookie 名称
export const SESSION_COOKIE = "mb_session";

// 登录用户信息，随 JWT 一起下发
export type SessionUser = {
  username: string;
  displayName: string;
  color: string;
};

// 会话有效期（天）
export function sessionMaxAgeDays(): number {
  const raw = Number(process.env.SESSION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 365) : 7;
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET 未配置或过短，请在 .env 中设置至少 16 位的随机字符串");
  }
  return new TextEncoder().encode(secret);
}

// 签发会话令牌
export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.displayName, color: user.color })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.username)
    .setIssuedAt()
    .setExpirationTime(`${sessionMaxAgeDays()}d`)
    .sign(getSecret());
}

// 校验会话令牌，失败返回 null
export async function verifySession(token?: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      username: payload.sub,
      displayName: typeof payload.name === "string" ? payload.name : payload.sub,
      color: typeof payload.color === "string" ? payload.color : "#6353f5",
    };
  } catch {
    return null;
  }
}
