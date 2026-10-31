import { database } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail, unauthorized } from "@/lib/http";
import { HISTORY_WINDOW_MS, reverse } from "@/lib/history/engine.mjs";

// 全局操作记录：所有人可见，但只有本人能撤销/重做自己的操作
export async function GET() {
  const user = await getSession();
  if (!user) return unauthorized();

  const operations = await database.workOperation.findMany({
    where: { createdAt: { gte: new Date(Date.now() - HISTORY_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, actor: true, title: true, undone: true, createdAt: true },
  });

  return ok({ operations, username: user.username });
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return unauthorized();

  try {
    const body = await request.json();
    if (typeof body.id !== "string" || typeof body.redo !== "boolean") {
      return fail("请求无效");
    }
    await database.$transaction(
      (tx) => reverse(tx, user.username, body.id, body.redo),
      { timeout: 30000 }
    );
    return ok({ ok: true });
  } catch (error) {
    // 恢复对象时如果撞上唯一约束（例如同名标签已被别人重建），给出可读提示
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return fail("目标对象与现有内容冲突，暂时无法撤销或重做", 409);
    }
    return fail(error instanceof Error ? error.message : "操作失败", 409);
  }
}
