// 拖拽后的批量排序：校验归属后用事务一次性写入
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail, notFound, serverError, unauthorized } from "@/lib/http";

type RouteContext = { params: Promise<{ id: string }> };

type ListOrder = { id: string; sort: number };
type CardOrder = { id: string; listId: string; sort: number };

function isOrderBase(item: unknown): item is { id: string; sort: number } {
  if (!item || typeof item !== "object") return false;
  const record = item as Record<string, unknown>;
  return typeof record.id === "string" && Number.isInteger(record.sort) && (record.sort as number) >= 0;
}

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
  const rawLists = payload.lists === undefined ? [] : payload.lists;
  const rawCards = payload.cards === undefined ? [] : payload.cards;

  if (!Array.isArray(rawLists) || !Array.isArray(rawCards)) {
    return fail("排序数据格式不正确");
  }
  if (rawLists.length === 0 && rawCards.length === 0) {
    return ok({ ok: true });
  }

  try {
    const { id } = await params;
    const board = await prisma.board.findUnique({
      where: { id },
      select: {
        id: true,
        lists: { select: { id: true, cards: { select: { id: true } } } },
      },
    });
    if (!board) return notFound("看板不存在");

    const listIds = new Set(board.lists.map((list) => list.id));
    const cardIds = new Set(board.lists.flatMap((list) => list.cards.map((card) => card.id)));

    const lists: ListOrder[] = [];
    const listSeen = new Set<string>();
    for (const item of rawLists) {
      if (!isOrderBase(item) || !listIds.has(item.id)) {
        return fail("列表不属于当前看板或排序数据非法");
      }
      if (listSeen.has(item.id)) return fail("列表排序数据重复");
      listSeen.add(item.id);
      lists.push({ id: item.id, sort: item.sort });
    }

    const cards: CardOrder[] = [];
    const cardSeen = new Set<string>();
    for (const item of rawCards) {
      if (!isOrderBase(item)) return fail("卡片排序数据格式不正确");
      const record = item as unknown as Record<string, unknown>;
      if (typeof record.listId !== "string") return fail("卡片排序缺少所属列表");
      if (!cardIds.has(item.id)) return fail("卡片不属于当前看板");
      if (!listIds.has(record.listId)) return fail("目标列表不属于当前看板");
      if (cardSeen.has(item.id)) return fail("卡片排序数据重复");
      cardSeen.add(item.id);
      cards.push({ id: item.id, listId: record.listId, sort: item.sort });
    }

    await prisma.$transaction(async (tx) => {
      for (const list of lists) {
        await tx.boardList.update({ where: { id: list.id }, data: { sort: list.sort } });
      }
      for (const card of cards) {
        await tx.boardCard.update({
          where: { id: card.id },
          data: { listId: card.listId, sort: card.sort },
        });
      }
      await tx.board.update({ where: { id }, data: { updatedAt: new Date() } });
    });

    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
