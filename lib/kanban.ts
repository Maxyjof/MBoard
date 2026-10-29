// 看板模块共享工具：DTO 序列化、标签解析、排序载荷计算
// 这里只做纯数据转换，不依赖 Prisma 生成类型，方便客户端复用

import type {
  AttachmentDTO,
  BoardDetail,
  BoardSummary,
  CardDTO,
  CardLabel,
  ListDTO,
} from "@/lib/types";

/// 单张卡片最多负责人数
export const MAX_ASSIGNEES = 10;

/// 看板主题色预设
export const ACCENT_PRESETS = [
  "#6353f5",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
];

/// 标签可选色板
export const LABEL_PALETTE = [
  "#6353f5",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
];

/// 常用标签预设，点击即可快速添加
export const LABEL_PRESETS: CardLabel[] = [
  { name: "功能", color: "#6353f5" },
  { name: "增强", color: "#0ea5e9" },
  { name: "核心", color: "#f59e0b" },
  { name: "基础", color: "#10b981" },
  { name: "设计", color: "#ec4899" },
  { name: "待定", color: "#64748b" },
];

/// 单张卡片最多标签数
export const MAX_LABELS = 6;

// 数据库记录的最小结构，由 Prisma include 结果满足
export type AssetRecord = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: string;
};

export type AttachmentRecord = {
  id: string;
  assetId: string;
  asset: AssetRecord;
};

export type CardRecord = {
  id: string;
  title: string;
  descriptionMd: string;
  labels: string;
  assignees: string;
  dueDate: Date | null;
  archived: boolean;
  sort: number;
  coverAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachments?: AttachmentRecord[];
};

export type ListRecord = {
  id: string;
  title: string;
  sort: number;
  cards?: CardRecord[];
};

export type BoardRecord = {
  id: string;
  title: string;
  description: string | null;
  accent: string;
  updatedAt: Date;
};

export type ReorderPayload = {
  lists?: { id: string; sort: number }[];
  cards?: { id: string; listId: string; sort: number }[];
};

// 是否为合法的 #RRGGBB 颜色
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

// 裁剪文本：去首尾空格并限制长度，空串返回 null
export function cleanText(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function isCardLabel(value: unknown): value is CardLabel {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && isHexColor(record.color);
}

// 存库的标签是 JSON 字符串，解析失败时降级为空数组
export function parseLabels(raw: string): CardLabel[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isCardLabel)
      .map((label) => ({ name: label.name.trim().slice(0, 20), color: label.color }))
      .filter((label) => label.name.length > 0)
      .slice(0, MAX_LABELS);
  } catch {
    return [];
  }
}

// 校验并规范化请求里的标签，结构非法时返回 null
export function normalizeLabels(value: unknown): CardLabel[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const labels: CardLabel[] = [];

  for (const item of value) {
    if (!isCardLabel(item)) return null;
    const name = item.name.trim().slice(0, 20);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    labels.push({ name, color: item.color });
    if (labels.length >= MAX_LABELS) break;
  }

  return labels;
}

// 标签的浅色底样式，卡片与选择器共用
export function labelStyle(color: string): React.CSSProperties {
  const safe = isHexColor(color) ? color : "#6353f5";
  return {
    backgroundColor: `${safe}1f`,
    color: safe,
    borderColor: `${safe}40`,
  };
}

// 存库的负责人是用户名 JSON 数组，解析失败时降级为空数组
export function parseAssignees(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const usernames: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const username = item.trim();
      if (!username || seen.has(username)) continue;
      seen.add(username);
      usernames.push(username);
      if (usernames.length >= MAX_ASSIGNEES) break;
    }
    return usernames;
  } catch {
    return [];
  }
}

// 校验并规范化请求里的负责人，结构非法时返回 null（账号是否存在由接口层校验）
export function normalizeAssignees(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const seen = new Set<string>();
  const usernames: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") return null;
    const username = item.trim();
    if (!username) continue;
    if (seen.has(username)) continue;
    seen.add(username);
    usernames.push(username.slice(0, 64));
    if (usernames.length >= MAX_ASSIGNEES) break;
  }

  return usernames;
}

export function toAttachmentDTO(record: AttachmentRecord): AttachmentDTO {
  return {
    id: record.id,
    assetId: record.assetId,
    filename: record.asset.filename,
    mimeType: record.asset.mimeType,
    size: record.asset.size,
    kind: record.asset.kind,
    url: `/api/assets/${record.assetId}`,
  };
}

export function toCardDTO(card: CardRecord): CardDTO {
  return {
    id: card.id,
    title: card.title,
    descriptionMd: card.descriptionMd,
    labels: parseLabels(card.labels),
    assignees: parseAssignees(card.assignees),
    dueDate: card.dueDate ? card.dueDate.toISOString() : null,
    archived: card.archived,
    sort: card.sort,
    coverAssetId: card.coverAssetId,
    attachments: (card.attachments ?? []).map(toAttachmentDTO),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

export function toListDTO(list: ListRecord): ListDTO {
  return {
    id: list.id,
    title: list.title,
    sort: list.sort,
    cards: (list.cards ?? []).map(toCardDTO),
  };
}

export function toBoardDetail(board: BoardRecord): BoardDetail {
  return {
    id: board.id,
    title: board.title,
    description: board.description,
    accent: board.accent,
    updatedAt: board.updatedAt.toISOString(),
  };
}

export function toBoardSummary(
  board: BoardRecord,
  listsCount: number,
  cardsCount: number
): BoardSummary {
  return {
    id: board.id,
    title: board.title,
    description: board.description,
    accent: board.accent,
    listsCount,
    cardsCount,
    updatedAt: board.updatedAt.toISOString(),
  };
}

// 对比拖拽前后生成最小 reorder 载荷，未变化时返回 null
export function buildReorderPayload(
  before: ListDTO[],
  after: ListDTO[]
): ReorderPayload | null {
  if (before.length !== after.length) return null;

  const payload: ReorderPayload = {};
  const beforeListIndex = new Map(before.map((list, index) => [list.id, index]));
  const listChanges = after.flatMap((list, index) =>
    beforeListIndex.get(list.id) === index ? [] : [{ id: list.id, sort: index }]
  );
  if (listChanges.length > 0) payload.lists = listChanges;

  const beforeCards = new Map<string, { listId: string; index: number }>();
  for (const list of before) {
    list.cards.forEach((card, index) => beforeCards.set(card.id, { listId: list.id, index }));
  }

  const cardChanges: { id: string; listId: string; sort: number }[] = [];
  for (const list of after) {
    list.cards.forEach((card, index) => {
      const previous = beforeCards.get(card.id);
      if (!previous || previous.listId !== list.id || previous.index !== index) {
        cardChanges.push({ id: card.id, listId: list.id, sort: index });
      }
    });
  }
  if (cardChanges.length > 0) payload.cards = cardChanges;

  if (!payload.lists && !payload.cards) return null;
  return payload;
}
