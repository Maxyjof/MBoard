import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { updatePassword, verifyCurrentPassword } from "@/lib/auth/profile";
import { fail, ok } from "@/lib/http";

const BodySchema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: z.string().min(6, "新密码至少 6 位").max(64, "新密码最多 64 位"),
    confirmPassword: z.string().min(1, "请再次输入新密码"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "两次输入的新密码不一致",
  });

// 修改自己的登录密码（写入数据库覆盖配置文件的初始密码）
export async function POST(request: Request) {
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
    const verified = await verifyCurrentPassword(session.username, parsed.data.currentPassword);
    if (!verified) return fail("当前密码不正确");

    const updated = await updatePassword(session.username, parsed.data.newPassword);
    if (!updated) return fail("账号已不在配置文件中", 404);

    return ok({ ok: true });
  } catch (error) {
    console.error("[account/password]", error);
    return fail("修改密码失败，请稍后重试", 500);
  }
}
