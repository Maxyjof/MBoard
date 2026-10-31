import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { fail, ok, serverError, unauthorized } from "@/lib/http";
import { withHistory } from "@/lib/history/route";
import { LABEL_MODELS } from "@/lib/history/engine.mjs";

type Context = { params: Promise<{ id: string }> };

// 保存标签顺序：必须提交当前看板的全部标签 id，避免漏掉或混入其他看板
async function handlePOST(request: Request, { params }: Context) {
  if (!(await getSession())) return unauthorized();

  try {
    const boardId = (await params).id;
    const body = await request.json();
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return fail("标签排序数据格式不正确");
    }

    const unique = new Set(ids as string[]);
    const labels = await prisma.boardLabel.findMany({ where: { boardId }, select: { id: true } });
    if (
      unique.size !== ids.length ||
      labels.length !== ids.length ||
      labels.some((label) => !unique.has(label.id))
    ) {
      return fail("标签排序数据与当前看板不一致，请刷新后重试", 409);
    }

    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < ids.length; index += 1) {
        await tx.boardLabel.update({ where: { id: ids[index] }, data: { sort: index } });
      }
      await tx.board.update({ where: { id: boardId }, data: { updatedAt: new Date() } });
    });

    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

export const POST = withHistory("调整标签顺序", handlePOST, LABEL_MODELS);
