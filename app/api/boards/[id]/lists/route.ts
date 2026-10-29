// 在看板下新建列表
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail, notFound, serverError, unauthorized } from "@/lib/http";
import { cleanText, toListDTO } from "@/lib/kanban";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("请求体不是合法的 JSON");
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const title = cleanText(payload.title, 40);
  if (!title) return fail("列表名称不能为空");

  try {
    const { id } = await params;
    const board = await prisma.board.findUnique({ where: { id }, select: { id: true } });
    if (!board) return notFound("看板不存在");

    const maxSort = await prisma.boardList.aggregate({
      where: { boardId: id },
      _max: { sort: true },
    });
    const list = await prisma.boardList.create({
      data: { boardId: id, title, sort: (maxSort._max.sort ?? -1) + 1 },
    });
    await prisma.board.update({ where: { id }, data: { updatedAt: new Date() } });

    const dto = toListDTO(list);
    return ok({ list: dto }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
