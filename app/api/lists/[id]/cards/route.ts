// 在列表下新建卡片
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail, notFound, serverError, unauthorized } from "@/lib/http";
import { cleanText, toCardDTO } from "@/lib/kanban";

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
  const title = cleanText(payload.title, 120);
  if (!title) return fail("卡片标题不能为空");
  if (payload.descriptionMd !== undefined && typeof payload.descriptionMd !== "string") {
    return fail("卡片描述格式不正确");
  }
  const descriptionMd =
    typeof payload.descriptionMd === "string" ? payload.descriptionMd.slice(0, 50_000) : "";

  try {
    const { id } = await params;
    const list = await prisma.boardList.findUnique({
      where: { id },
      select: { id: true, boardId: true },
    });
    if (!list) return notFound("列表不存在");

    const maxSort = await prisma.boardCard.aggregate({
      where: { listId: id },
      _max: { sort: true },
    });
    const card = await prisma.boardCard.create({
      data: { listId: id, title, descriptionMd, sort: (maxSort._max.sort ?? -1) + 1 },
    });
    await prisma.board.update({
      where: { id: list.boardId },
      data: { updatedAt: new Date() },
    });

    return ok({ card: toCardDTO(card) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
