import type { DocumentDTO } from "@/lib/types";

export const DOC_TITLE_MAX = 120;
export const DOC_CONTENT_MAX = 200_000;

export const documentListSelect = {
  id: true,
  title: true,
  createdAt: true,
  updatedAt: true,
} as const;

type DocRow = {
  id: string;
  title: string;
  contentMd: string;
  createdAt: Date;
  updatedAt: Date;
};

export function toDocumentDTO(row: DocRow): DocumentDTO {
  return {
    id: row.id,
    title: row.title,
    contentMd: row.contentMd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

// 文档标题必填，正文可空
export function parseDocumentCreate(value: unknown): ParseResult<{ title: string; contentMd: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, error: "请求体格式不正确" };
  }

  const body = value as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { success: false, error: "请填写文档标题" };
  if (title.length > DOC_TITLE_MAX) {
    return { success: false, error: `标题不能超过 ${DOC_TITLE_MAX} 个字符` };
  }

  const contentMd = body.contentMd === undefined ? "" : body.contentMd;
  if (typeof contentMd !== "string") return { success: false, error: "正文格式不正确" };
  if (contentMd.length > DOC_CONTENT_MAX) {
    return { success: false, error: `正文不能超过 ${DOC_CONTENT_MAX} 个字符` };
  }

  return { success: true, data: { title, contentMd } };
}

// 文档更新：只接受 title / contentMd，且至少传一个
export function parseDocumentUpdate(
  value: unknown
): ParseResult<{ title?: string; contentMd?: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, error: "请求体格式不正确" };
  }

  const body = value as Record<string, unknown>;
  const data: { title?: string; contentMd?: string } = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return { success: false, error: "请填写文档标题" };
    if (title.length > DOC_TITLE_MAX) {
      return { success: false, error: `标题不能超过 ${DOC_TITLE_MAX} 个字符` };
    }
    data.title = title;
  }

  if (body.contentMd !== undefined) {
    if (typeof body.contentMd !== "string") return { success: false, error: "正文格式不正确" };
    if (body.contentMd.length > DOC_CONTENT_MAX) {
      return { success: false, error: `正文不能超过 ${DOC_CONTENT_MAX} 个字符` };
    }
    data.contentMd = body.contentMd;
  }

  if (Object.keys(data).length === 0) {
    return { success: false, error: "没有需要更新的内容" };
  }

  return { success: true, data };
}
