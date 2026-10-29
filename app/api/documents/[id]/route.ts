import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound, ok, readJson, serverError, withSession } from "@/lib/http";
import { parseDocumentUpdate, toDocumentDTO } from "../_shared";

type RouteContext = { params: Promise<{ id: string }> };

const detailSelect = {
  id: true,
  title: true,
  contentMd: true,
  createdAt: true,
  updatedAt: true,
} as const;

function isMissing(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

// 文档详情
export async function GET(_request: Request, { params }: RouteContext) {
  return withSession(async () => {
    const { id } = await params;

    try {
      const row = await prisma.document.findUnique({ where: { id }, select: detailSelect });
      if (!row) return notFound("文档不存在");
      return ok({ document: toDocumentDTO(row) });
    } catch (error) {
      return serverError(error);
    }
  });
}

// 更新文档
export async function PATCH(request: Request, { params }: RouteContext) {
  return withSession(async () => {
    const { id } = await params;
    const parsed = await readJson(request, parseDocumentUpdate);
    if ("error" in parsed) return parsed.error;

    try {
      const row = await prisma.document.update({
        where: { id },
        data: parsed.data,
        select: detailSelect,
      });
      return ok({ document: toDocumentDTO(row) });
    } catch (error) {
      if (isMissing(error)) return notFound("文档不存在");
      return serverError(error);
    }
  });
}

// 删除文档
export async function DELETE(_request: Request, { params }: RouteContext) {
  return withSession(async () => {
    const { id } = await params;

    try {
      await prisma.document.delete({ where: { id } });
      return ok({ ok: true });
    } catch (error) {
      if (isMissing(error)) return notFound("文档不存在");
      return serverError(error);
    }
  });
}
