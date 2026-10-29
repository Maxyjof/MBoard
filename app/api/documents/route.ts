import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, readJson, serverError, withSession } from "@/lib/http";
import {
  documentListSelect,
  parseDocumentCreate,
  toDocumentDTO,
} from "./_shared";

// 文档列表：支持 ?q= 搜索标题与正文，列表不返回正文以减轻体积
export async function GET(request: Request) {
  return withSession(async () => {
    const q = (new URL(request.url).searchParams.get("q") || "").trim();

    const where: Prisma.DocumentWhereInput | undefined = q
      ? { OR: [{ title: { contains: q } }, { contentMd: { contains: q } }] }
      : undefined;

    try {
      const documents = await prisma.document.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        select: documentListSelect,
      });
      return ok({ documents });
    } catch (error) {
      return serverError(error);
    }
  });
}

// 新建文档
export async function POST(request: Request) {
  return withSession(async () => {
    const parsed = await readJson(request, parseDocumentCreate);
    if ("error" in parsed) return parsed.error;

    try {
      const row = await prisma.document.create({
        data: parsed.data,
        select: { id: true, title: true, contentMd: true, createdAt: true, updatedAt: true },
      });
      return ok({ document: toDocumentDTO(row) }, { status: 201 });
    } catch (error) {
      return serverError(error);
    }
  });
}
