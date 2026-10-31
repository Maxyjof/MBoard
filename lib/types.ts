// 前后端共享的数据结构定义
// 所有接口都返回这几种形状，便于独立开发看板与画布模块

export type AppUser = {
  username: string;
  displayName: string;
  color: string;
};

export type BoardSummary = {
  id: string;
  title: string;
  description: string | null;
  accent: string;
  listsCount: number;
  cardsCount: number;
  updatedAt: string;
};

export type CardLabel = {
  name: string;
  color: string;
};

export type AttachmentDTO = {
  id: string;
  assetId: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: string;
  url: string;
};

export type CardDTO = {
  id: string;
  title: string;
  descriptionMd: string;
  labels: CardLabel[];
  assignees: string[];
  dueDate: string | null;
  archived: boolean;
  sort: number;
  coverAssetId: string | null;
  attachments: AttachmentDTO[];
  createdAt: string;
  updatedAt: string;
};

/// 可被分配为负责人的成员（配置文件账号 + 个人显示名覆盖）
export type MemberDTO = {
  username: string;
  displayName: string;
  color: string;
};

export type ListDTO = {
  id: string;
  title: string;
  sort: number;
  cards: CardDTO[];
};

export type BoardDetail = {
  id: string;
  title: string;
  description: string | null;
  accent: string;
  updatedAt: string;
};

export type BoardPayload = {
  board: BoardDetail;
  lists: ListDTO[];
};

export type CanvasSummary = {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  version: number;
  lastEditor: string | null;
  createdAt: string;
  updatedAt: string;
  elementCount: number;
};

export type SceneData = {
  elements: unknown[];
  appState?: {
    viewBackgroundColor?: string;
    gridSize?: number | null;
    [key: string]: unknown;
  };
};

export type CanvasPayload = {
  canvas: CanvasSummary;
  scene: SceneData;
};

export type DocumentDTO = {
  id: string;
  title: string;
  contentMd: string;
  kind: "markdown" | "table";
  createdAt: string;
  updatedAt: string;
};

export type AssetDTO = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: string;
  url: string;
};

// 统一的接口错误结构
export type ApiError = {
  error: string;
};
