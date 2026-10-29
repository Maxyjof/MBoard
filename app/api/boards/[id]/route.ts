// 单个看板：详情（含列表与卡片）、更新、删除
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail, notFound, serverError, unauthorized } from "@/lib/http";
import {
  cleanText,
  isHexColor,
  toBoardDetail,
  toListDTO,
} from "@/lib/kanban";

type RouteContext = { params: Promise<{ id: string }> };

// 详情统一 include：列表按 sort 升序，卡片过滤归档并按 sort 升序
const boardDetailInclude = {
  lists: {
    orderBy: { sort: "asc" as const },
    include: {
      cards: {
        where: { archived: false },
        orderBy: { sort: "asc" as const },
        include: {
          attachments: {
            orderBy: { createdAt: "asc" as const },
            include: { asset: true },
          },
        },
      },
    },
  },
};

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { id } = await params;
    const board = await prisma.board.findUnique({
      where: { id },
      include: boardDetailInclude,
    });
    if (!board) return notFound("看板不存在");

    return ok({ board: toBoardDetail(board), lists: board.lists.map(toListDTO) });
  } catch (error) {
    return serverError(error);
  }
}

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
  const data: { title?: string; description?: string | null; accent?: string } = {};

  if ("title" in payload) {
    const title = cleanText(payload.title, 60);
    if (!title) return fail("看板名称不能为空");
    data.title = title;
  }
  if ("description" in payload) {
    if (payload.description !== null && typeof payload.description !== "string") {
      return fail("看板描述格式不正确");
    }
    data.description = payload.description
      ? payload.description.trim().slice(0, 300) || null
      : null;
  }
  if ("accent" in payload) {
    if (!isHexColor(payload.accent)) return fail("主题色格式不正确");
    data.accent = payload.accent;
  }

  if (Object.keys(data).length === 0) return fail("没有需要更新的字段");

  try {
    const { id } = await params;
    const existing = await prisma.board.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return notFound("看板不存在");

    const board = await prisma.board.update({ where: { id }, data });
    return ok({ board: toBoardDetail(board) });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { id } = await params;
    const existing = await prisma.board.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return notFound("看板不存在");

    // 列表、卡片、附件由数据库级联删除
    await prisma.board.delete({ where: { id } });
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
