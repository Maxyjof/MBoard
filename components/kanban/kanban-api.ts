// 看板模块客户端请求封装：统一错误消息与类型
import type {
  AssetDTO,
  AttachmentDTO,
  BoardDetail,
  CardDTO,
  CardLabel,
  ListDTO,
} from "@/lib/types";
import type { ReorderPayload } from "@/lib/kanban";

export type ListPatchResult = { id: string; title: string; sort: number };

export type CardPatch = {
  title?: string;
  descriptionMd?: string;
  labels?: CardLabel[];
  assignees?: string[];
  dueDate?: string | null;
  archived?: boolean;
  coverAssetId?: string | null;
};

export type BoardPatch = {
  title?: string;
  description?: string | null;
  accent?: string;
};

// 解析接口错误并抛出带中文消息的异常
async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error("网络异常，请检查连接后重试");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const raw =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: unknown }).error
        : null;
    throw new Error(typeof raw === "string" && raw ? raw : `请求失败（${response.status}）`);
  }

  return payload as T;
}

function jsonRequest(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export async function createList(boardId: string, title: string): Promise<ListDTO> {
  const data = await request<{ list: ListDTO }>(
    `/api/boards/${boardId}/lists`,
    jsonRequest("POST", { title })
  );
  return data.list;
}

export async function updateList(listId: string, title: string): Promise<ListPatchResult> {
  const data = await request<{ list: ListPatchResult }>(
    `/api/lists/${listId}`,
    jsonRequest("PATCH", { title })
  );
  return data.list;
}

export async function deleteList(listId: string): Promise<void> {
  await request<{ ok: true }>(`/api/lists/${listId}`, { method: "DELETE" });
}

export async function createCard(listId: string, title: string): Promise<CardDTO> {
  const data = await request<{ card: CardDTO }>(
    `/api/lists/${listId}/cards`,
    jsonRequest("POST", { title })
  );
  return data.card;
}

export async function updateCard(cardId: string, patch: CardPatch): Promise<CardDTO> {
  const data = await request<{ card: CardDTO }>(
    `/api/cards/${cardId}`,
    jsonRequest("PATCH", patch)
  );
  return data.card;
}

export async function deleteCard(cardId: string): Promise<void> {
  await request<{ ok: true }>(`/api/cards/${cardId}`, { method: "DELETE" });
}

export async function reorderBoard(boardId: string, payload: ReorderPayload): Promise<void> {
  await request<{ ok: true }>(`/api/boards/${boardId}/reorder`, jsonRequest("POST", payload));
}

export async function updateBoard(boardId: string, patch: BoardPatch): Promise<BoardDetail> {
  const data = await request<{ board: BoardDetail }>(
    `/api/boards/${boardId}`,
    jsonRequest("PATCH", patch)
  );
  return data.board;
}

export async function deleteBoard(boardId: string): Promise<void> {
  await request<{ ok: true }>(`/api/boards/${boardId}`, { method: "DELETE" });
}

// 上传文件到共享资源接口，返回资源信息
export async function uploadAsset(file: File): Promise<AssetDTO> {
  const form = new FormData();
  form.append("file", file);
  const data = await request<{ asset: AssetDTO }>("/api/assets", {
    method: "POST",
    body: form,
  });
  return data.asset;
}

export async function addAttachment(cardId: string, assetId: string): Promise<AttachmentDTO> {
  const data = await request<{ attachment: AttachmentDTO }>(
    `/api/cards/${cardId}/attachments`,
    jsonRequest("POST", { assetId })
  );
  return data.attachment;
}

export async function deleteAttachment(cardId: string, attachmentId: string): Promise<void> {
  await request<{ ok: true }>(`/api/cards/${cardId}/attachments/${attachmentId}`, {
    method: "DELETE",
  });
}
