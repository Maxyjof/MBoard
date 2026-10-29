import { getSession } from "@/lib/auth/session";
import { listMembers } from "@/lib/members";
import { ok, serverError, unauthorized } from "@/lib/http";

// 可分配负责人列表（所有登录用户可见）
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    return ok({ members: await listMembers() });
  } catch (error) {
    return serverError(error);
  }
}
