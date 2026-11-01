import { jwtVerify } from "jose";

// WebSocket 通道（协作画布 / 系统通知）共用的登录态校验
// HTTP 接口走 Next 的 cookie 读取，长连接只能自己解析 Cookie 头

export const SESSION_COOKIE = "mb_session";

const encoder = new TextEncoder();

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 未配置");
  return encoder.encode(secret);
}

// 把 Cookie 头解析成对象，格式非法时返回空对象
export function parseCookies(header = "") {
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

// 校验长连接携带的会话，未登录或令牌失效返回 null
export async function authenticateRequest(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
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
