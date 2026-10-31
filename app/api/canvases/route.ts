import { prisma } from "@/lib/prisma";
import { ok, readJson, serverError, withSession } from "@/lib/http";
import { canvasSelect, parseCanvasCreate, toCanvasSummary } from "./_shared";

// 画板列表：按最近更新时间倒序
export async function GET() {
  return withSession(async () => {
    try {
      const rows = await prisma.canvas.findMany({
        orderBy: { updatedAt: "desc" },
        select: canvasSelect,
      });
      return ok({ canvases: rows.map(toCanvasSummary) });
    } catch (error) {
      return serverError(error);
    }
  });
}

// 新建画板
export async function POST(request: Request) {
  return withSession(async (session) => {
    const parsed = await readJson(request, parseCanvasCreate);
    if ("error" in parsed) return parsed.error;

    try {
      const row = await prisma.canvas.create({
        data: {
          title: parsed.data.title,
          description: parsed.data.description,
          lastEditor: session.displayName,
        },
        select: canvasSelect,
      });
      return ok({ canvas: toCanvasSummary(row) }, { status: 201 });
    } catch (error) {
      return serverError(error);
    }
  });
}
