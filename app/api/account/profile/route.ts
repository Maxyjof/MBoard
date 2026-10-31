import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { updateProfile } from "@/lib/auth/profile";
import { applySessionCookie } from "@/lib/auth/cookie";
import { fail, ok } from "@/lib/http";

const BodySchema = z.object({
  displayName: z.string().trim().min(1, "显示名不能为空").max(24, "显示名最多 24 个字符"),
});

// 修改自己的显示名
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return fail("未登录或登录已过期", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("请求体不是合法的 JSON");
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || "参数不合法");
  }

  try {
    const user = await updateProfile(session.username, parsed.data.displayName);
    if (!user) return fail("账号已不在配置文件中", 404);

    const response = ok({ user });
    await applySessionCookie(response, user);
    return response;
  } catch (error) {
    console.error("[account/profile]", error);
    return fail("保存失败，请稍后重试", 500);
  }
}
