// 单张卡片：更新（标题/描述/标签/截止日期/归档/封面）、删除
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail, notFound, serverError, unauthorized } from "@/lib/http";
import { cleanText, normalizeLabels, toCardDTO } from "@/lib/kanban";

type RouteContext = { params: Promise<{ id: string }> };

type CardUpdateData = {
  title?: string;
  descriptionMd?: string;
  labels?: string;
  dueDate?: Date | null;
  archived?: boolean;
  coverAssetId?: string | null;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("请求体不是合法的 JSON");
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const data: CardUpdateData = {};

  if ("title" in payload) {
    const title = cleanText(payload.title, 120);
    if (!title) return fail("卡片标题不能为空");
    data.title = title;
  }
  if ("descriptionMd" in payload) {
    if (typeof payload.descriptionMd !== "string") return fail("卡片描述格式不正确");
    data.descriptionMd = payload.descriptionMd.slice(0, 50_000);
  }
  if ("labels" in payload) {
    const labels = normalizeLabels(payload.labels);
    if (!labels) return fail("标签格式不正确");
    data.labels = JSON.stringify(labels);
  }
  if ("dueDate" in payload) {
    if (payload.dueDate === null || payload.dueDate === "") {
      data.dueDate = null;
    } else if (typeof payload.dueDate === "string") {
      const parsed = new Date(payload.dueDate);
      if (Number.isNaN(parsed.getTime())) return fail("截止日期格式不正确");
      data.dueDate = parsed;
    } else {
      return fail("截止日期格式不正确");
    }
  }
  if ("archived" in payload) {
    if (typeof payload.archived !== "boolean") return fail("归档状态格式不正确");
    data.archived = payload.archived;
  }
  // 封面资源存在性放到事务前的 try 里校验，避免数据库异常绕过统一错误响应
  let coverAssetId: string | null | undefined;
  if ("coverAssetId" in payload) {
    if (payload.coverAssetId === null || payload.coverAssetId === "") {
      coverAssetId = null;
    } else if (typeof payload.coverAssetId === "string") {
      coverAssetId = payload.coverAssetId;
    } else {
      return fail("封面格式不正确");
    }
  }

  if (Object.keys(data).length === 0 && coverAssetId === undefined) {
    return fail("没有需要更新的字段");
  }

  try {
    const { id } = await params;
    const existing = await prisma.boardCard.findUnique({
      where: { id },
      select: { id: true, list: { select: { boardId: true } } },
    });
    if (!existing) return notFound("卡片不存在");

    if (coverAssetId !== undefined) {
      if (coverAssetId !== null) {
        const asset = await prisma.asset.findUnique({
          where: { id: coverAssetId },
          select: { id: true },
        });
        if (!asset) return notFound("封面资源不存在");
      }
      data.coverAssetId = coverAssetId;
    }

    const card = await prisma.boardCard.update({
      where: { id },
      data,
      include: {
        attachments: {
          orderBy: { createdAt: "asc" },
          include: { asset: true },
        },
      },
    });
    await prisma.board.update({
      where: { id: existing.list.boardId },
      data: { updatedAt: new Date() },
    });

    return ok({ card: toCardDTO(card) });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { id } = await params;
    const existing = await prisma.boardCard.findUnique({
      where: { id },
      select: { id: true, list: { select: { boardId: true } } },
    });
    if (!existing) return notFound("卡片不存在");

    await prisma.boardCard.delete({ where: { id } });
    await prisma.board.update({
      where: { id: existing.list.boardId },
      data: { updatedAt: new Date() },
    });

    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
