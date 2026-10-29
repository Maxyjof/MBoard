import { prisma } from "@/lib/prisma";
import { CanvasLibrary } from "@/components/canvas/library/canvas-library";
import { canvasSelect, toCanvasSummary } from "@/app/api/canvases/_shared";

export const metadata = {
  title: "画板库",
};

// 画板库页面：服务端直读数据库，首屏无需额外请求
export default async function CanvasesPage() {
  const rows = await prisma.canvas.findMany({
    orderBy: { updatedAt: "desc" },
    select: canvasSelect,
  });

  return <CanvasLibrary initialCanvases={rows.map(toCanvasSummary)} />;
}
