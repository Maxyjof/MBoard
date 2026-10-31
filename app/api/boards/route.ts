// 看板集合：列表查询与新建
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail, serverError, unauthorized } from "@/lib/http";
import { ACCENT_PRESETS, cleanText, isHexColor, toBoardSummary } from "@/lib/kanban";

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const boards = await prisma.board.findMany({
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      include: {
        _count: { select: { lists: true } },
        lists: {
          select: { _count: { select: { cards: { where: { archived: false } } } } },
        },
      },
    });

    return ok({
      boards: boards.map((board) =>
        toBoardSummary(
          board,
          board._count.lists,
          board.lists.reduce((total, list) => total + list._count.cards, 0)
        )
      ),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("请求体不是合法的 JSON");
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const title = cleanText(payload.title, 60);
  if (!title) return fail("看板名称不能为空");
  const description =
    typeof payload.description === "string" ? payload.description.trim().slice(0, 300) || null : null;
  const accent = isHexColor(payload.accent) ? payload.accent : ACCENT_PRESETS[0];

  try {
    const maxSort = await prisma.board.aggregate({ _max: { sort: true } });
    const board = await prisma.board.create({
      data: { title, description, accent, sort: (maxSort._max.sort ?? -1) + 1 },
    });
    return ok({ board: toBoardSummary(board, 0, 0) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
