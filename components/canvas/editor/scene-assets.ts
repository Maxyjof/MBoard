"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { AssetDTO } from "@/lib/types";

// 从接口拉取资源并转成 dataURL，供 Excalidraw 的 files 使用
export async function fetchAssetDataURL(assetId: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/assets/${assetId}`);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await blobToDataURL(blob);
  } catch {
    return null;
  }
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// 上传文件到共享资源库
export async function uploadAsset(file: File, kind?: string): Promise<AssetDTO> {
  const form = new FormData();
  form.append("file", file);
  if (kind) form.append("kind", kind);

  const response = await fetch("/api/assets", { method: "POST", body: form });
  const data = (await response.json()) as { asset?: AssetDTO; error?: string };

  if (!response.ok || !data.asset) {
    throw new Error(data.error || "上传失败");
  }
  return data.asset;
}

// 把场景里引用的图片资源批量注入 Excalidraw
export async function hydrateSceneFiles(
  elements: readonly any[],
  api: ExcalidrawImperativeAPI,
  loaded: Set<string>
): Promise<void> {
  const pending = elements.filter(
    (element) =>
      element?.type === "image" &&
      element?.fileId &&
      element?.customData?.assetId &&
      !loaded.has(element.fileId) &&
      !element.isDeleted
  );

  if (pending.length === 0) return;

  await Promise.all(
    pending.slice(0, 30).map(async (element) => {
      const assetId = element.customData.assetId as string;
      const dataURL = await fetchAssetDataURL(assetId);
      if (!dataURL) return;

      loaded.add(element.fileId);
      api.addFiles([
        {
          id: element.fileId,
          dataURL,
          mimeType: (element.customData.mimeType as string) || "image/png",
          created: Date.now(),
          lastRetrieved: Date.now(),
        } as any,
      ]);
    })
  );
}

// 读取图片原始尺寸，用于按比例插入画布
export function readImageSize(dataURL: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 640, height: 400 });
    image.src = dataURL;
  });
}
