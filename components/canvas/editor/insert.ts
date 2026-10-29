"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { AssetDTO, DocumentDTO } from "@/lib/types";
import { readImageSize } from "./scene-assets";

// 当前视口中心对应的画布坐标
function viewportCenter(api: ExcalidrawImperativeAPI) {
  const appState = api.getAppState();
  const zoom = appState.zoom?.value ?? 1;
  return {
    x: appState.width / 2 / zoom - appState.scrollX,
    y: appState.height / 2 / zoom - appState.scrollY,
  };
}

// 追加元素到场景，并选中新元素
function appendElements(
  api: ExcalidrawImperativeAPI,
  elements: readonly any[],
  customData?: Record<string, unknown>
) {
  const prepared = elements.map((element) =>
    customData ? { ...element, customData: { ...(element.customData || {}), ...customData } } : element
  );

  const selectedElementIds: Record<string, boolean> = {};
  for (const element of prepared) selectedElementIds[element.id] = true;

  api.updateScene({
    elements: [...api.getSceneElements(), ...prepared] as any,
    appState: { selectedElementIds } as any,
  });
}

// 延迟加载 Excalidraw，避免服务端渲染时访问 window
async function build(skeletons: any[]) {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  return convertToExcalidrawElements(skeletons, { regenerateIds: false });
}

// 插入便签
export async function insertSticky(api: ExcalidrawImperativeAPI, text = "双击编辑便签") {
  const center = viewportCenter(api);
  const elements = await build([
    {
      type: "rectangle",
      x: center.x - 110,
      y: center.y - 70,
      width: 220,
      height: 140,
      backgroundColor: "#ffec99",
      fillStyle: "solid",
      strokeColor: "#e8a33d",
      strokeWidth: 1,
      roundness: { type: 3 },
      label: { text, fontSize: 16, textAlign: "center", verticalAlign: "middle" },
    },
  ]);
  appendElements(api, elements);
}

// 插入纯文本
export async function insertText(api: ExcalidrawImperativeAPI, text = "输入文字") {
  const center = viewportCenter(api);
  const elements = await build([
    { type: "text", text, x: center.x - 60, y: center.y - 14, fontSize: 20 },
  ]);
  appendElements(api, elements);
}

// 插入基础形状
export async function insertShape(
  api: ExcalidrawImperativeAPI,
  type: "rectangle" | "ellipse" | "diamond"
) {
  const center = viewportCenter(api);
  const elements = await build([
    {
      type,
      x: center.x - 90,
      y: center.y - 60,
      width: 180,
      height: 120,
      backgroundColor: "#d0bfff",
      fillStyle: "solid",
      strokeColor: "#6741d9",
      strokeWidth: 2,
      roundness: type === "rectangle" ? { type: 3 } : undefined,
      label: { text: "节点", fontSize: 16, textAlign: "center", verticalAlign: "middle" },
    },
  ]);
  appendElements(api, elements);
}

// 插入图片（资源已上传，dataURL 直接注入 Excalidraw）
export async function insertImage(api: ExcalidrawImperativeAPI, asset: AssetDTO, dataURL: string) {
  const size = await readImageSize(dataURL);
  const fileId = crypto.randomUUID();
  api.addFiles([
    {
      id: fileId,
      dataURL,
      mimeType: asset.mimeType,
      created: Date.now(),
      lastRetrieved: Date.now(),
    } as any,
  ]);

  const center = viewportCenter(api);
  const scale = Math.min(1, 520 / Math.max(size.width, 1));
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);

  const elements = await build([
    {
      type: "image",
      fileId,
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
    },
  ]);

  appendElements(api, elements, { assetId: asset.id, mimeType: asset.mimeType });
}

// 插入 Markdown 文档卡片
export async function insertDocCard(
  api: ExcalidrawImperativeAPI,
  doc: Pick<DocumentDTO, "id" | "title">
) {
  const center = viewportCenter(api);
  const elements = await build([
    {
      type: "rectangle",
      x: center.x - 130,
      y: center.y - 55,
      width: 260,
      height: 110,
      backgroundColor: "#e7f5ff",
      fillStyle: "solid",
      strokeColor: "#1971c2",
      strokeWidth: 1.5,
      roundness: { type: 3 },
      label: {
        text: `📄 ${doc.title}\n选中后可在右侧预览`,
        fontSize: 14,
        textAlign: "left",
        verticalAlign: "middle",
      },
    },
  ]);

  appendElements(api, elements, { mbDocId: doc.id, mbDocTitle: doc.title });
}

// 插入视频卡片
export async function insertVideoCard(api: ExcalidrawImperativeAPI, asset: AssetDTO) {
  const center = viewportCenter(api);
  const elements = await build([
    {
      type: "rectangle",
      x: center.x - 140,
      y: center.y - 80,
      width: 280,
      height: 160,
      backgroundColor: "#1b1b1f",
      fillStyle: "solid",
      strokeColor: "#495057",
      strokeWidth: 2,
      roundness: { type: 3 },
      label: {
        text: `▶ ${asset.filename}\n选中后可在右侧播放`,
        fontSize: 14,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: "#ffffff",
      },
    },
  ]);

  appendElements(api, elements, { mbVideoAssetId: asset.id, mbVideoName: asset.filename });
}

// 设置激活工具（画矩形/箭头等）
export function activateTool(
  api: ExcalidrawImperativeAPI,
  type: "selection" | "rectangle" | "ellipse" | "diamond" | "arrow" | "freedraw" | "text"
) {
  api.setActiveTool({ type } as any);
}
