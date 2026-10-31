import { withHistory } from "@/lib/history/route";
import { LIST_MODELS } from "@/lib/history/engine.mjs";
// 单个列表：重命名、删除
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail, notFound, serverError, unauthorized } from "@/lib/http";
import { cleanText } from "@/lib/kanban";

type RouteContext = { params: Promise<{ id: string }> };

async function handlePATCH(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("请求体不是合法的 JSON");
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  if (!("title" in payload)) return fail("没有需要更新的字段");
  const title = cleanText(payload.title, 40);
  if (!title) return fail("列表名称不能为空");

  try {
    const { id } = await params;
    const existing = await prisma.boardList.findUnique({
      where: { id },
      select: { id: true, boardId: true },
    });
    if (!existing) return notFound("列表不存在");

    const list = await prisma.boardList.update({ where: { id }, data: { title } });
    await prisma.board.update({
      where: { id: existing.boardId },
      data: { updatedAt: new Date() },
    });

    return ok({ list: { id: list.id, title: list.title, sort: list.sort } });
  } catch (error) {
    return serverError(error);
  }
}

async function handleDELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { id } = await params;
    const existing = await prisma.boardList.findUnique({
      where: { id },
      select: { id: true, boardId: true },
    });
    if (!existing) return notFound("列表不存在");

    // 列表下的卡片与附件随级联删除
    await prisma.boardList.delete({ where: { id } });
    await prisma.board.update({
      where: { id: existing.boardId },
      data: { updatedAt: new Date() },
    });

    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

export const PATCH = withHistory("重命名列表", handlePATCH, LIST_MODELS);

export const DELETE = withHistory("删除列表", handleDELETE, LIST_MODELS);
