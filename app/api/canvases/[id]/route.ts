import { withHistory } from "@/lib/history/route";
import { CANVAS_ASSET_MODELS, CANVAS_MODELS } from "@/lib/history/engine.mjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound, ok, readJson, serverError, withSession } from "@/lib/http";
import { removeAsset } from "@/lib/assets";
import { canvasSelect, parseCanvasUpdate, parseScene, toCanvasSummary } from "../_shared";

type RouteContext = { params: Promise<{ id: string }> };

function isMissing(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

// 画板详情：摘要信息 + 场景快照，编辑器首屏用它兜底
export async function GET(_request: Request, { params }: RouteContext) {
  return withSession(async () => {
    const { id } = await params;

    try {
      const row = await prisma.canvas.findUnique({ where: { id }, select: canvasSelect });
      if (!row) return notFound("画板不存在");

      return ok({ canvas: toCanvasSummary(row), scene: parseScene(row.sceneJson) });
    } catch (error) {
      return serverError(error);
    }
  });
}

// 更新画板标题/描述
async function handlePATCH(request: Request, { params }: RouteContext) {
  return withSession(async (session) => {
    const { id } = await params;
    const parsed = await readJson(request, parseCanvasUpdate);
    if ("error" in parsed) return parsed.error;

    try {
      const row = await prisma.canvas.update({
        where: { id },
        data: { ...parsed.data, lastEditor: session.displayName },
        select: canvasSelect,
      });
      return ok({ canvas: toCanvasSummary(row) });
    } catch (error) {
      if (isMissing(error)) return notFound("画板不存在");
      return serverError(error);
    }
  });
}

// 删除画板，同时清理只属于它的缩略图资源
async function handleDELETE(_request: Request, { params }: RouteContext) {
  return withSession(async () => {
    const { id } = await params;

    try {
      const row = await prisma.canvas.findUnique({
        where: { id },
        select: { thumbnailAssetId: true },
      });
      if (!row) return notFound("画板不存在");

      await prisma.canvas.delete({ where: { id } });

      if (row.thumbnailAssetId) {
        await removeAsset(row.thumbnailAssetId).catch(() => undefined);
      }

      return ok({ ok: true });
    } catch (error) {
      if (isMissing(error)) return notFound("画板不存在");
      return serverError(error);
    }
  });
}

export const PATCH = withHistory("修改画板", handlePATCH, CANVAS_MODELS);

export const DELETE = withHistory("删除画板", handleDELETE, CANVAS_ASSET_MODELS);
