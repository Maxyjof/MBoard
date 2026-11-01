import { getSession } from "@/lib/auth/session";
import { ok, serverError, unauthorized } from "@/lib/http";
import { buildSnapshot } from "@/lib/system/spool";

// 页面轮询的唯一真相来源：合并应用版本、更新服务心跳与 spool 状态
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    return ok(buildSnapshot(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return serverError(error);
  }
}
