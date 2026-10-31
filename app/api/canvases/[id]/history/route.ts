import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { fail, ok, serverError, unauthorized } from "@/lib/http";
import { HISTORY_WINDOW_MS } from "@/lib/history/engine.mjs";

type Context = { params: Promise<{ id: string }> };
const PAGE_SIZE = 100;

// 画板历史：只读快照列表，供本地预览使用
export async function GET(request: Request, { params }: Context) {
  if (!(await getSession())) return unauthorized();

  try {
    const canvasId = (await params).id;
    const query = new URL(request.url).searchParams;
    const entryId = query.get("entry");
    const cursor = query.get("cursor");
    const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS);

    // 单条快照：返回完整场景，供只读预览渲染
    if (entryId) {
      const entry = await prisma.canvasHistory.findFirst({
        where: { id: entryId, canvasId, createdAt: { gte: cutoff } },
        select: { id: true, sceneJson: true },
      });
      return entry ? ok({ entry }) : fail("历史记录不存在或已过期", 404);
    }

    // 游标过期（超过 30 天被清理）时退化成第一页，避免前端卡死
    const cursorEntry = cursor
      ? await prisma.canvasHistory.findFirst({
          where: { id: cursor, canvasId, createdAt: { gte: cutoff } },
          select: { id: true },
        })
      : null;

    const entries = await prisma.canvasHistory.findMany({
      where: { canvasId, createdAt: { gte: cutoff } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursorEntry ? { cursor: { id: cursorEntry.id }, skip: 1 } : {}),
      select: { id: true, actor: true, createdAt: true },
    });

    return ok({ entries: entries.slice(0, PAGE_SIZE), hasMore: entries.length > PAGE_SIZE });
  } catch (error) {
    return serverError(error);
  }
}
