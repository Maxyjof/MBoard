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

// 连续插入时在视口内寻找一个尽量不重叠的位置，避免卡片叠在一起或跑出屏幕
function cascadeCenter(api: ExcalidrawImperativeAPI, width: number, height: number) {
  const state = api.getAppState();
  const zoom = state.zoom?.value ?? 1;
  const center = {
    x: state.width / 2 / zoom - state.scrollX,
    y: state.height / 2 / zoom - state.scrollY,
  };
  const sceneLeft = -state.scrollX;
  const sceneTop = -state.scrollY;
  const sceneRight = sceneLeft + state.width / zoom;
  const sceneBottom = sceneTop + state.height / zoom;
  const elements = api.getSceneElements();

  const offsets = [
    [0, 0],
    [300, 0],
    [-300, 0],
    [0, 180],
    [300, 180],
    [-300, 180],
    [0, -180],
    [300, -180],
    [-300, -180],
  ];

  for (const [offsetX, offsetY] of offsets) {
    const x = center.x + offsetX;
    const y = center.y + offsetY;
    const left = x - width / 2;
    const top = y - height / 2;
    const inside =
      left >= sceneLeft + 20 &&
      top >= sceneTop + 20 &&
      left + width <= sceneRight - 20 &&
      top + height <= sceneBottom - 20;
    if (!inside) continue;

    const overlaps = elements.some((element) => {
      const right = element.x + element.width;
      const bottom = element.y + element.height;
      return left < right && left + width > element.x && top < bottom && top + height > element.y;
    });
    if (!overlaps) return { x, y };
  }

  // 实在找不到空位就回到中心，保证一定可见
  return center;
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
  const center = cascadeCenter(api, 220, 140);
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
  const center = cascadeCenter(api, 180, 120);
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

  const scale = Math.min(1, 520 / Math.max(size.width, 1));
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  const position = cascadeCenter(api, width, height);

  const elements = await build([
    {
      type: "image",
      fileId,
      x: position.x - width / 2,
      y: position.y - height / 2,
      width,
      height,
    },
  ]);

  appendElements(api, elements, { assetId: asset.id, mimeType: asset.mimeType });
}

// 根据文件名和文档类型给文档卡片一套区分度更高的外观
function docVisual(title: string, kind: "markdown" | "table") {
  const lower = title.toLowerCase();
  if (kind === "table") {
    return { background: "#f3f0ff", stroke: "#7048e8", icon: "📊", type: "表格" };
  }
  if (lower.endsWith(".txt") || lower.endsWith(".csv")) {
    return { background: "#f8f9fa", stroke: "#868e96", icon: "📃", type: "文本文件" };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return { background: "#e7f5ff", stroke: "#1971c2", icon: "📄", type: "Markdown 文档" };
  }
  return { background: "#eef2ff", stroke: "#4c6ef5", icon: "📄", type: "文档" };
}

// 文件卡片外观：与便签明显区分，并标出文件类型
function fileVisual(filename: string, mimeType: string) {
  const lower = filename.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return { background: "#fff5f5", stroke: "#e03131", icon: "📕", type: "PDF 文件" };
  }
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) {
    return { background: "#e7f5ff", stroke: "#1971c2", icon: "📘", type: "Word 文档" };
  }
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx") || lower.endsWith(".csv")) {
    return { background: "#ebfbee", stroke: "#2b8a3e", icon: "📗", type: "表格文件" };
  }
  if (lower.endsWith(".ppt") || lower.endsWith(".pptx")) {
    return { background: "#fff4e6", stroke: "#e8590c", icon: "📙", type: "演示文件" };
  }
  return { background: "#f8f9fa", stroke: "#868e96", icon: "📎", type: "文件" };
}

// 插入文档卡片（Markdown / 表格 / 纯文本统一走文档）
export async function insertDocCard(
  api: ExcalidrawImperativeAPI,
  doc: Pick<DocumentDTO, "id" | "title" | "kind">
) {
  const center = cascadeCenter(api, 280, 120);
  const visual = docVisual(doc.title, doc.kind);
  const elements = await build([
    {
      type: "rectangle",
      x: center.x - 140,
      y: center.y - 60,
      width: 280,
      height: 120,
      backgroundColor: visual.background,
      fillStyle: "solid",
      strokeColor: visual.stroke,
      strokeWidth: 1.5,
      roundness: { type: 3 },
      label: {
        text: `${visual.icon} ${doc.title}\n${visual.type} · 点击打开`,
        fontSize: 14,
        textAlign: "left",
        verticalAlign: "middle",
      },
    },
  ]);

  appendElements(api, elements, {
    mbDocId: doc.id,
    mbDocTitle: doc.title,
    mbDocKind: doc.kind,
  });
}

// 插入 PDF / Office 等不可编辑文件卡片
export async function insertFileCard(api: ExcalidrawImperativeAPI, asset: AssetDTO) {
  const center = cascadeCenter(api, 280, 120);
  const visual = fileVisual(asset.filename, asset.mimeType);
  const elements = await build([
    {
      type: "rectangle",
      x: center.x - 140,
      y: center.y - 60,
      width: 280,
      height: 120,
      backgroundColor: visual.background,
      fillStyle: "solid",
      strokeColor: visual.stroke,
      strokeWidth: 1.5,
      roundness: { type: 3 },
      label: {
        text: `${visual.icon} ${asset.filename}\n${visual.type} · 点击打开`,
        fontSize: 14,
        textAlign: "left",
        verticalAlign: "middle",
      },
    },
  ]);

  appendElements(api, elements, {
    mbFileAssetId: asset.id,
    mbFileName: asset.filename,
    mbFileMime: asset.mimeType,
  });
}

// 插入视频卡片
export async function insertVideoCard(api: ExcalidrawImperativeAPI, asset: AssetDTO) {
  const center = cascadeCenter(api, 280, 160);
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

// 把元素上的 frameId 回写到画框 children，保证画框移动时子元素跟着走
export function syncFrameChildren(api: ExcalidrawImperativeAPI): boolean {
  const elements = api.getSceneElements();
  let changed = false;

  const next = elements.map((element: any) => {
    if (element.type !== "frame") return element;
    const childIds = elements
      .filter((item: any) => item.type !== "frame" && item.frameId === element.id)
      .map((item: any) => item.id);
    const current = Array.isArray(element.children) ? element.children : [];
    const same =
      current.length === childIds.length &&
      current.every((id: string, index: number) => id === childIds[index]);
    if (same) return element;
    changed = true;
    return {
      ...element,
      children: childIds,
      version: element.version + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
    };
  });

  if (changed) {
    api.updateScene({
      elements: next as any,
      captureUpdate: "NEVER",
    });
  }
  return changed;
}

// 插入原生画框：内部组件数量不限，拖入的图片/文本会自动成为画框成员
export function insertFrame(api: ExcalidrawImperativeAPI) {
  const width = 760;
  const height = 520;
  const center = cascadeCenter(api, width, height);
  const frame: any = {
    id: crypto.randomUUID(),
    type: "frame",
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    angle: 0,
    strokeColor: "#ced4da",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    name: "新画框",
    children: [],
  };

  api.updateScene({
    elements: [...api.getSceneElements(), frame] as any,
    appState: { selectedElementIds: { [frame.id]: true } } as any,
    captureUpdate: "IMMEDIATELY",
  });
}

// 组合卡片：标题 + 字段列表 + 关联文档，整体作为一个分组移动
export type CompositeCardInput = {
  title: string;
  fields: string[];
  document?: {
    id: string;
    title: string;
    words?: number;
  } | null;
};

export async function insertCompositeCard(
  api: ExcalidrawImperativeAPI,
  input: CompositeCardInput
) {
  const width = 420;
  const headerHeight = 100;
  const fieldHeight = 58;
  const fieldGap = 8;
  const docHeight = input.document ? 78 : 0;
  const height =
    headerHeight + input.fields.length * (fieldHeight + fieldGap) + docHeight + 24;

  const center = cascadeCenter(api, width, height);
  const x = center.x - width / 2;
  const y = center.y - height / 2;
  const groupId = crypto.randomUUID();
  const contentWidth = width - 80;

  const skeletons: any[] = [
    {
      type: "rectangle",
      x,
      y,
      width,
      height,
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeColor: "#dee2e6",
      strokeWidth: 1.5,
      roundness: { type: 3 },
    },
    {
      type: "text",
      x: x + 24,
      y: y + 20,
      width: width - 48,
      text: input.title || "未命名组合",
      fontSize: 22,
      fontFamily: 2,
      textAlign: "center",
      strokeColor: "#1e1e1e",
    },
    {
      type: "text",
      x: x + 24,
      y: y + 56,
      width: width - 48,
      text: `${input.fields.length} 个字段${input.document ? " · 1 个文档" : ""}`,
      fontSize: 13,
      fontFamily: 2,
      textAlign: "center",
      strokeColor: "#868e96",
    },
  ];

  input.fields.forEach((field, index) => {
    const rowY = y + headerHeight + index * (fieldHeight + fieldGap);
    skeletons.push({
      type: "rectangle",
      x: x + 20,
      y: rowY,
      width: width - 40,
      height: fieldHeight,
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeColor: "#e9ecef",
      strokeWidth: 1,
      roundness: { type: 2 },
    });
    skeletons.push({
      type: "text",
      x: x + 36,
      y: rowY + 16,
      width: contentWidth,
      text: field || "填写内容",
      fontSize: 15,
      fontFamily: 2,
      strokeColor: "#343a40",
    });
  });

  const built = await build(skeletons);

  // convert 对 text 的宽度处理不一致，这里强制标题居中、副标题左对齐
  const titleElement = built[1] as any;
  if (titleElement?.type === "text") {
    titleElement.x = x + 24;
    titleElement.width = width - 48;
    titleElement.textAlign = "center";
  }
  const metaElement = built[2] as any;
  if (metaElement?.type === "text") {
    metaElement.x = x + 24;
    metaElement.width = width - 48;
    metaElement.textAlign = "left";
  }

  const docRowY = y + headerHeight + input.fields.length * (fieldHeight + fieldGap);
  const docSkeletons: any[] = input.document
    ? [
        {
          type: "rectangle",
          x: x + 20,
          y: docRowY,
          width: width - 40,
          height: 70,
          backgroundColor: "#f8f9fa",
          fillStyle: "solid",
          strokeColor: "#e9ecef",
          strokeWidth: 1,
          roundness: { type: 2 },
        },
        {
          type: "text",
          x: x + 36,
          y: docRowY + 20,
          text: "📄",
          fontSize: 22,
          fontFamily: 2,
          strokeColor: "#495057",
        },
        {
          type: "text",
          x: x + 76,
          y: docRowY + 12,
          width: width - 120,
          text: input.document.title,
          fontSize: 15,
          fontFamily: 2,
          strokeColor: "#343a40",
        },
        {
          type: "text",
          x: x + 76,
          y: docRowY + 38,
          width: width - 120,
          text: `${input.document.words ?? 0} 字 · 点击打开`,
          fontSize: 12,
          fontFamily: 2,
          strokeColor: "#868e96",
        },
      ]
    : [];

  const docElements = docSkeletons.length > 0 ? await build(docSkeletons) : [];
  if (input.document && docElements.length > 0) {
    (docElements[0] as any).customData = {
      mbDocId: input.document.id,
      mbDocTitle: input.document.title,
    };
    (docElements[2] as any).customData = {
      mbDocId: input.document.id,
      mbDocTitle: input.document.title,
    };
  }

  const allElements = [...built, ...docElements];

  // 统一分组，拖动任意成员即可整体移动
  for (const element of allElements) {
    (element as any).groupIds = [groupId];
  }

  const selectedElementIds: Record<string, boolean> = {};
  for (const element of allElements) selectedElementIds[(element as any).id] = true;

  api.updateScene({
    elements: [...api.getSceneElements(), ...allElements] as any,
    appState: { selectedElementIds } as any,
    captureUpdate: "IMMEDIATELY",
  });
}

// 把选中的元素分组，拖动任意成员即可整体移动
export async function groupSelectedElements(api: ExcalidrawImperativeAPI): Promise<boolean> {
  const state = api.getAppState();
  const selectedIds = Object.keys(state.selectedElementIds || {}).filter(
    (id) => state.selectedElementIds[id]
  );
  const elements = api.getSceneElements();
  const selected = elements.filter(
    (element) => selectedIds.includes(element.id) && !(element as any).isDeleted
  );
  if (selected.length === 0) return false;

  const groupId = crypto.randomUUID();
  const minX = Math.min(...selected.map((element) => element.x));
  const minY = Math.min(...selected.map((element) => element.y));
  const maxX = Math.max(...selected.map((element) => element.x + element.width));
  const maxY = Math.max(...selected.map((element) => element.y + element.height));

  const built = await build([
    {
      type: "rectangle",
      x: minX - 28,
      y: minY - 58,
      width: maxX - minX + 56,
      height: maxY - minY + 86,
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeColor: "#ced4da",
      strokeWidth: 1.5,
      roundness: { type: 3 },
    },
    {
      type: "text",
      x: minX,
      y: minY - 44,
      text: "分组容器",
      fontSize: 18,
      strokeColor: "#343a40",
    },
  ]);

  const background = built[0] as any;
  const title = built[1] as any;
  background.groupIds = [groupId];
  background.customData = { mbGroup: "1" };
  title.groupIds = [groupId];
  title.customData = { mbGroup: "1" };

  const selectedSet = new Set(selectedIds);
  const updated = elements.map((element) => {
    if (!selectedSet.has(element.id)) return element;
    return {
      ...element,
      groupIds: [...((element as any).groupIds || []), groupId],
      version: element.version + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
    };
  });

  const firstIndex = updated.findIndex((element) => selectedSet.has(element.id));
  if (firstIndex < 0) return false;

  const next = [...updated];
  next.splice(firstIndex, 0, background, title);

  const selectedElementIds: Record<string, boolean> = {};
  for (const element of [background, title, ...updated.filter((item) => selectedSet.has(item.id))]) {
    selectedElementIds[element.id] = true;
  }

  api.updateScene({
    elements: next as any,
    appState: { selectedElementIds } as any,
    captureUpdate: "IMMEDIATELY",
  });
  return true;
}

// 取消选中元素涉及的所有分组
export function ungroupSelectedElements(api: ExcalidrawImperativeAPI): boolean {
  const state = api.getAppState();
  const selectedIds = Object.keys(state.selectedElementIds || {}).filter(
    (id) => state.selectedElementIds[id]
  );
  const elements = api.getSceneElements();
  const selected = elements.filter((element) => selectedIds.includes(element.id));
  const groupIds = new Set(selected.flatMap((element) => (element as any).groupIds || []));
  if (groupIds.size === 0) return false;

  const next = elements.map((element) => {
    const current = (element as any).groupIds || [];
    const remaining = current.filter((id: string) => !groupIds.has(id));
    if (remaining.length === current.length) return element;
    return {
      ...element,
      groupIds: remaining,
      version: element.version + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
    };
  });

  api.updateScene({
    elements: next as any,
    captureUpdate: "IMMEDIATELY",
  });
  return true;
}

// 设置激活工具（画矩形/箭头等）
export function activateTool(
  api: ExcalidrawImperativeAPI,
  type: "selection" | "rectangle" | "ellipse" | "diamond" | "arrow" | "freedraw" | "text"
) {
  api.setActiveTool({ type } as any);
}
