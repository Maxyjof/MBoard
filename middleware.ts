import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

// 无需登录即可访问的路径
const PUBLIC_PATHS = ["/login"];

function isAssetPath(pathname: string) {
  return /\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json|js|css|woff2?)$/i.test(pathname);
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // 应用部署在 basePath 下，middleware 拿到的 pathname 已剥离前缀，
  // 而 new URL("/x", request.url) 会丢掉 basePath，必须显式补回，
  // 否则登录/跳转会落到站点根域的 /login、/boards（被 nginx 转发到论坛后端）
  const basePath = request.nextUrl.basePath || "";

  if (pathname.startsWith("/_next") || isAssetPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  // 已登录访问登录页，直接回工作台
  if (PUBLIC_PATHS.includes(pathname)) {
    if (session) {
      return NextResponse.redirect(new URL(`${basePath}/boards`, request.url));
    }
    return NextResponse.next();
  }

  if (session) return NextResponse.next();

  // 登录接口、健康检查放行
  if (pathname === "/api/auth/login" || pathname === "/api/health") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未登录或登录已过期" }, { status: 401 });
  }

  const loginUrl = new URL(`${basePath}/login`, request.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("next", pathname + search);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
