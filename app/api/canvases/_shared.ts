import type { Prisma } from "@prisma/client";
import type { CanvasSummary, SceneData } from "@/lib/types";

export const CANVAS_TITLE_MAX = 80;
export const CANVAS_DESC_MAX = 400;
export const DEFAULT_CANVAS_TITLE = "未命名画板";

// 列表/详情共用的字段集合，避免把 ydoc 二进制读出来
export const canvasSelect = {
  id: true,
  title: true,
  description: true,
  sceneJson: true,
  thumbnailAssetId: true,
  version: true,
  lastEditor: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CanvasSelect;

export type CanvasRow = Prisma.CanvasGetPayload<{ select: typeof canvasSelect }>;

type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

// sceneJson 解析失败时不阻塞页面，按空画布处理
export function parseScene(sceneJson: string | null | undefined): SceneData {
  if (!sceneJson) return { elements: [] };

  try {
    const parsed: unknown = JSON.parse(sceneJson);
    if (!parsed || typeof parsed !== "object") return { elements: [] };

    const record = parsed as Record<string, unknown>;
    const elements = Array.isArray(record.elements) ? record.elements : [];
    const appState =
      record.appState && typeof record.appState === "object" && !Array.isArray(record.appState)
        ? (record.appState as SceneData["appState"])
        : undefined;

    return appState ? { elements, appState } : { elements };
  } catch {
    return { elements: [] };
  }
}

export function countElements(sceneJson: string | null | undefined): number {
  return parseScene(sceneJson).elements.length;
}

export function toCanvasSummary(row: CanvasRow): CanvasSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    thumbnailUrl: row.thumbnailAssetId ? `/api/assets/${row.thumbnailAssetId}` : null,
    version: row.version,
    lastEditor: row.lastEditor,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    elementCount: countElements(row.sceneJson),
  };
}

function readString(value: unknown, field: string, max: number, required: boolean) {
  if (value === undefined) {
    return required ? { success: false as const, error: `请填写${field}` } : { success: true as const, data: undefined };
  }
  if (value === null) {
    return required
      ? ({ success: false, error: `请填写${field}` } as const)
      : ({ success: true, data: null } as const);
  }
  if (typeof value !== "string") {
    return { success: false as const, error: `${field}格式不正确` };
  }

  const trimmed = value.trim();
  if (required && !trimmed) return { success: false as const, error: `请填写${field}` };
  if (trimmed.length > max) return { success: false as const, error: `${field}不能超过 ${max} 个字符` };

  return { success: true as const, data: trimmed };
}

// 新建画板：标题可省略，描述可为空
export function parseCanvasCreate(value: unknown): ParseResult<{ title: string; description: string | null }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, error: "请求体格式不正确" };
  }

  const body = value as Record<string, unknown>;
  const title = readString(body.title, "画板名称", CANVAS_TITLE_MAX, false);
  if (!title.success) return { success: false, error: title.error };

  const description = readString(body.description, "画板描述", CANVAS_DESC_MAX, false);
  if (!description.success) return { success: false, error: description.error };

  return {
    success: true,
    data: {
      title: (title.data as string | undefined) || DEFAULT_CANVAS_TITLE,
      description: (description.data as string | null | undefined) ?? null,
    },
  };
}

// 更新画板：只接受 title / description，且至少传一个
export function parseCanvasUpdate(
  value: unknown
): ParseResult<{ title?: string; description?: string | null }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, error: "请求体格式不正确" };
  }

  const body = value as Record<string, unknown>;
  const data: { title?: string; description?: string | null } = {};

  if (body.title !== undefined) {
    const title = readString(body.title, "画板名称", CANVAS_TITLE_MAX, true);
    if (!title.success) return { success: false, error: title.error };
    data.title = title.data as string;
  }

  if (body.description !== undefined) {
    const description = readString(body.description, "画板描述", CANVAS_DESC_MAX, false);
    if (!description.success) return { success: false, error: description.error };
    data.description = description.data as string | null;
  }

  if (Object.keys(data).length === 0) {
    return { success: false, error: "没有需要更新的内容" };
  }

  return { success: true, data };
}
