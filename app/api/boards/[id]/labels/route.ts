import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { fail, ok, serverError, unauthorized } from "@/lib/http";
import { withHistory } from "@/lib/history/route";
import { LABEL_MODELS } from "@/lib/history/engine.mjs";
import { LABEL_PRESETS, cleanText, isHexColor, parseLabels } from "@/lib/kanban";

type Context = { params: Promise<{ id: string }> };

/**
 * 老看板首次访问时把预设标签和卡片里已有的标签导入标签表。
 * 新看板在创建时已经带好预设标签，这里只做一次幂等迁移。
 */
async function ensureBoardLabels(boardId: string) {
  return prisma.$transaction(async (tx) => {
    const board = await tx.board.findUnique({
      where: { id: boardId },
      include: { lists: { include: { cards: { select: { labels: true } } } } },
    });
    if (!board) return null;

    if (!board.labelsInitialized) {
      const labels = new Map(LABEL_PRESETS.map((label) => [label.name, label]));
      for (const list of board.lists) {
        for (const card of list.cards) {
          for (const label of parseLabels(card.labels)) labels.set(label.name, label);
        }
      }
      let sort = 0;
      for (const label of labels.values()) {
        await tx.boardLabel.upsert({
          where: { boardId_name: { boardId, name: label.name } },
          create: { boardId, ...label, sort },
          update: {},
        });
        sort += 1;
      }
      await tx.board.update({ where: { id: boardId }, data: { labelsInitialized: true } });
    }

    return tx.boardLabel.findMany({
      where: { boardId },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
    });
  });
}

// 标签表：每个看板独立维护
export async function GET(_request: Request, { params }: Context) {
  if (!(await getSession())) return unauthorized();
  try {
    const labels = await ensureBoardLabels((await params).id);
    return labels ? ok({ labels }) : fail("看板不存在", 404);
  } catch (error) {
    return serverError(error);
  }
}

async function handlePOST(request: Request, { params }: Context) {
  if (!(await getSession())) return unauthorized();

  try {
    const boardId = (await params).id;
    const body = await request.json();
    const name = cleanText(body.name, 20);
    if (!name || !isHexColor(body.color)) return fail("标签名称或颜色无效");
    if (!(await ensureBoardLabels(boardId))) return fail("看板不存在", 404);
    if (await prisma.boardLabel.findUnique({ where: { boardId_name: { boardId, name } } })) {
      return fail("标签名称已存在", 409);
    }

    const maxSort = await prisma.boardLabel.aggregate({ where: { boardId }, _max: { sort: true } });
    const label = await prisma.boardLabel.create({
      data: { boardId, name, color: body.color, sort: (maxSort._max.sort ?? -1) + 1 },
    });
    return ok({ label });
  } catch (error) {
    return serverError(error);
  }
}

async function handlePATCH(request: Request, { params }: Context) {
  if (!(await getSession())) return unauthorized();

  try {
    const boardId = (await params).id;
    const body = await request.json();
    const name = cleanText(body.name, 20);
    if (typeof body.id !== "string" || !name || !isHexColor(body.color)) return fail("标签名称或颜色无效");

    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.boardLabel.findFirst({ where: { id: body.id, boardId } });
      if (!previous) return "missing" as const;
      const duplicated = await tx.boardLabel.findFirst({
        where: { boardId, name, NOT: { id: previous.id } },
      });
      if (duplicated) return "duplicate" as const;

      await tx.boardLabel.update({ where: { id: previous.id }, data: { name, color: body.color } });
      // 卡片里的标签是 JSON 快照，重命名/改色后同步刷新
      const cards = await tx.boardCard.findMany({
        where: { list: { boardId } },
        select: { id: true, labels: true },
      });
      for (const card of cards) {
        const labels = parseLabels(card.labels);
        if (!labels.some((label) => label.name === previous.name)) continue;
        await tx.boardCard.update({
          where: { id: card.id },
          data: {
            labels: JSON.stringify(
              labels.map((label) =>
                label.name === previous.name ? { name, color: body.color } : label
              )
            ),
          },
        });
      }
      await tx.board.update({ where: { id: boardId }, data: { updatedAt: new Date() } });
      return "ok" as const;
    });

    if (result === "missing") return fail("标签不存在", 404);
    if (result === "duplicate") return fail("标签名称已存在", 409);
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

async function handleDELETE(request: Request, { params }: Context) {
  if (!(await getSession())) return unauthorized();

  try {
    const boardId = (await params).id;
    const body = await request.json();
    if (typeof body.id !== "string") return fail("标签无效");

    const removed = await prisma.$transaction(async (tx) => {
      const previous = await tx.boardLabel.findFirst({ where: { id: body.id, boardId } });
      if (!previous) return false;

      const cards = await tx.boardCard.findMany({
        where: { list: { boardId } },
        select: { id: true, labels: true },
      });
      for (const card of cards) {
        const labels = parseLabels(card.labels);
        if (!labels.some((label) => label.name === previous.name)) continue;
        await tx.boardCard.update({
          where: { id: card.id },
          data: {
            labels: JSON.stringify(labels.filter((label) => label.name !== previous.name)),
          },
        });
      }
      await tx.boardLabel.delete({ where: { id: previous.id } });
      await tx.board.update({ where: { id: boardId }, data: { updatedAt: new Date() } });
      return true;
    });

    return removed ? ok({ ok: true }) : fail("标签不存在", 404);
  } catch (error) {
    return serverError(error);
  }
}

export const POST = withHistory("添加标签", handlePOST, LABEL_MODELS);

export const PATCH = withHistory("修改标签", handlePATCH, LABEL_MODELS);

export const DELETE = withHistory("删除标签", handleDELETE, LABEL_MODELS);
