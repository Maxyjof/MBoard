// 删除卡片附件关联，资源文件本身保留给其他引用
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { ok, notFound, serverError, unauthorized } from "@/lib/http";

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const { id, attachmentId } = await params;
    const attachment = await prisma.cardAttachment.findFirst({
      where: { id: attachmentId, cardId: id },
      select: { id: true, card: { select: { list: { select: { boardId: true } } } } },
    });
    if (!attachment) return notFound("附件不存在");

    await prisma.cardAttachment.delete({ where: { id: attachment.id } });
    await prisma.board.update({
      where: { id: attachment.card.list.boardId },
      data: { updatedAt: new Date() },
    });

    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
