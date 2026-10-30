import type { DocumentDTO } from "@/lib/types";

export const DOC_TITLE_MAX = 120;
export const DOC_CONTENT_MAX = 200_000;
export const DOC_KINDS = ["markdown", "table"] as const;
export type DocumentKind = (typeof DOC_KINDS)[number];

export const documentListSelect = {
  id: true,
  title: true,
  kind: true,
  createdAt: true,
  updatedAt: true,
} as const;

type DocRow = {
  id: string;
  title: string;
  contentMd: string;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeKind(value: unknown): DocumentKind {
  return value === "table" ? "table" : "markdown";
}

export function toDocumentDTO(row: DocRow): DocumentDTO {
  return {
    id: row.id,
    title: row.title,
    contentMd: row.contentMd,
    kind: normalizeKind(row.kind),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

// 文档标题必填，正文可空；kind 支持 markdown 与 table
export function parseDocumentCreate(
  value: unknown
): ParseResult<{ title: string; contentMd: string; kind: DocumentKind }> {
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

  if (body.kind !== undefined && !DOC_KINDS.includes(body.kind as DocumentKind)) {
    return { success: false, error: "文档类型不正确" };
  }

  return {
    success: true,
    data: { title, contentMd, kind: normalizeKind(body.kind) },
  };
}

// 文档更新：接受 title / contentMd / kind，且至少传一个
export function parseDocumentUpdate(
  value: unknown
): ParseResult<{ title?: string; contentMd?: string; kind?: DocumentKind }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, error: "请求体格式不正确" };
  }

  const body = value as Record<string, unknown>;
  const data: { title?: string; contentMd?: string; kind?: DocumentKind } = {};

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

  if (body.kind !== undefined) {
    if (!DOC_KINDS.includes(body.kind as DocumentKind)) {
      return { success: false, error: "文档类型不正确" };
    }
    data.kind = body.kind as DocumentKind;
  }

  if (Object.keys(data).length === 0) {
    return { success: false, error: "没有需要更新的内容" };
  }

  return { success: true, data };
}
