// 给卡片添加附件：先由 /api/assets 上传，再把 assetId 关联到卡片
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, fail, notFound, serverError, unauthorized } from "@/lib/http";
import { toAttachmentDTO } from "@/lib/kanban";

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
  if (typeof payload.assetId !== "string" || !payload.assetId) {
    return fail("缺少 assetId");
  }
  const assetId = payload.assetId;

  try {
    const { id } = await params;
    const card = await prisma.boardCard.findUnique({
      where: { id },
      select: { id: true, list: { select: { boardId: true } } },
    });
    if (!card) return notFound("卡片不存在");

    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) return notFound("附件资源不存在");

    const duplicated = await prisma.cardAttachment.findFirst({
      where: { cardId: id, assetId },
      select: { id: true },
    });
    if (duplicated) return fail("该附件已添加");

    const attachment = await prisma.cardAttachment.create({
      data: { cardId: id, assetId },
      include: { asset: true },
    });
    await prisma.board.update({
      where: { id: card.list.boardId },
      data: { updatedAt: new Date() },
    });

    return ok({ attachment: toAttachmentDTO(attachment) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
