"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { AssetDTO, DocumentDTO } from "@/lib/types";
import {
  parseCompositeCardData,
  renderCompositeCard,
  type CompositeCardData,
} from "@/components/canvas/composite-card-render";
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
      backgroundColor: "#f8f9fa",
      fillStyle: "solid",
      strokeColor: "#adb5bd",
      strokeWidth: 1,
      roughness: 0,
      roundness: null,
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
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeColor: "#868e96",
      strokeWidth: 1,
      roughness: 0,
      roundness: type === "rectangle" ? null : undefined,
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
    return { background: "#f8f9fa", stroke: "#868e96", icon: "📊", type: "表格" };
  }
  if (lower.endsWith(".txt") || lower.endsWith(".csv")) {
    return { background: "#f8f9fa", stroke: "#868e96", icon: "📃", type: "文本文件" };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return { background: "#f8f9fa", stroke: "#868e96", icon: "📄", type: "Markdown 文档" };
  }
  return { background: "#f8f9fa", stroke: "#868e96", icon: "📄", type: "文档" };
}

type InsertTable = { headers: string[]; rows: string[][] };

function parseTableForCanvas(markdown: string): InsertTable {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const split = (line: string) => {
    let value = line;
    if (value.startsWith("|")) value = value.slice(1);
    if (value.endsWith("|")) value = value.slice(0, -1);
    return value.split("|").map((cell) => cell.trim().replace(/\\\|/g, "|"));
  };
  if (lines.length >= 2) {
    const headers = split(lines[0]);
    const divider = split(lines[1]);
    if (headers.length && divider.every((cell) => /^:?-{2,}:?$/.test(cell))) {
      return {
        headers,
        rows: lines.slice(2).map((line) => {
          const cells = split(line);
          return headers.map((_, index) => cells[index] ?? "");
        }),
      };
    }
  }
  return { headers: ["列 1", "列 2", "列 3"], rows: [["", "", ""], ["", "", ""]] };
}

export async function insertTableCard(
  api: ExcalidrawImperativeAPI,
  doc: Pick<DocumentDTO, "id" | "title" | "contentMd">,
  fixedCenter?: { x: number; y: number }
) {
  const table = parseTableForCanvas(doc.contentMd);
  const columnWidth = 150;
  const rowHeight = 42;
  const width = table.headers.length * columnWidth;
  const height = (table.rows.length + 1) * rowHeight;
  const center = fixedCenter || cascadeCenter(api, width, height);
  const svg = renderTableSvg(table, width, height, columnWidth, rowHeight);
  const fileId = crypto.randomUUID();
  api.addFiles([{ id: fileId, dataURL: svgDataURL(svg), mimeType: "image/svg+xml", created: Date.now(), lastRetrieved: Date.now() } as any]);
  const elements = await build([{ type: "image", fileId, x: center.x - width / 2, y: center.y - height / 2, width, height }]);
  appendElements(api, elements, { mbTableId: doc.id, mbTableTitle: doc.title });
}

function renderTableSvg(table: InsertTable, width: number, height: number, columnWidth: number, rowHeight: number) {
  const esc = escapeXml;
  const rows = [table.headers, ...table.rows];
  const cells = rows.flatMap((row, rowIndex) => row.map((cell, col) => {
    const x = col * columnWidth;
    const y = rowIndex * rowHeight;
    const fill = rowIndex === 0 ? "#f1f3f5" : "#ffffff";
    return `<rect x="${x}" y="${y}" width="${columnWidth}" height="${rowHeight}" fill="${fill}" stroke="#adb5bd" stroke-width="1"/><text x="${x + 12}" y="${y + 26}" font-family="Arial, sans-serif" font-size="14" fill="#343a40">${esc(cell)}</text>`;
  }).join(""));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${cells}</svg>`;
}

// 保存表格文档后，用最新 Markdown 重建画布中的原表格，保持原来的中心位置。
export async function updateTableCard(
  api: ExcalidrawImperativeAPI,
  doc: Pick<DocumentDTO, "id" | "title" | "contentMd">
): Promise<boolean> {
  const current = api.getSceneElements() as any[];
  const tableElements = current.filter((element) => element.customData?.mbTableId === doc.id);
  if (!tableElements.length) return false;

  const left = Math.min(...tableElements.map((element) => element.x));
  const top = Math.min(...tableElements.map((element) => element.y));
  const right = Math.max(...tableElements.map((element) => element.x + element.width));
  const bottom = Math.max(...tableElements.map((element) => element.y + element.height));
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };

  api.updateScene({
    elements: current.filter((element) => element.customData?.mbTableId !== doc.id) as any,
    captureUpdate: "IMMEDIATELY",
  });
  await insertTableCard(api, doc, center);
  return true;
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function svgDataURL(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function renderFileCard(asset: AssetDTO) {
  const visual = fileVisual(asset.filename, asset.mimeType);
  const width = 320;
  const height = 220;
  const title = asset.filename.length > 28 ? `${asset.filename.slice(0, 25)}…` : asset.filename;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="320" height="220" fill="#ffffff"/>
    <g transform="translate(112 8) scale(.094)">
      <path d="M792.3712 342.7328L608.256 165.2736c-8.6016-8.2944-20.0704-12.9024-32.1536-12.9024l-289.28-0.6144s-69.0176 4.5056-69.0176 67.584v585.4208s3.072 67.584 69.0176 67.584h450.3552s69.0176-3.1744 69.0176-67.584V374.8864c0-12.0832-5.0176-23.6544-13.824-32.1536zM609.1776 228.2496l120.6272 117.1456h-97.6896s-23.04-1.024-23.04-22.528c0.1024-21.504 0.1024-94.6176 0.1024-94.6176z m151.04 576.4096c0 22.6304-23.04 22.528-23.04 22.528H286.8224c-21.504 0-23.04-22.528-23.04-22.528V219.2384c0-20.992 23.04-22.528 23.04-22.528H563.2v126.0544c0 62.464 69.0176 67.584 69.0176 67.584h128v414.3104z" fill="#343a40"/>
      <path d="M365.3632 477.5936c0 12.4928 10.3424 22.528 23.04 22.528h248.32c12.6976 0 23.04-10.1376 23.04-22.528s-10.3424-22.528-23.04-22.528H388.4032c-12.6976 0-23.04 10.1376-23.04 22.528zM636.7232 568.7296H388.4032c-12.6976 0-23.04 10.1376-23.04 22.528s10.3424 22.528 23.04 22.528h248.32c12.6976 0 23.04-10.1376 23.04-22.528s-10.3424-22.528-23.04-22.528zM636.7232 682.3936H388.4032c-12.6976 0-23.04 10.1376-23.04 22.528s10.3424 22.528 23.04 22.528h248.32c12.6976 0 23.04-10.1376 23.04-22.528s-10.3424-22.528-23.04-22.528z" fill="#343a40"/>
    </g>
    <text x="160" y="174" text-anchor="middle" font-size="15" font-weight="600" fill="#343a40" font-family="Arial, sans-serif">${escapeXml(title)}</text>
    <text x="160" y="196" text-anchor="middle" font-size="12" fill="#868e96" font-family="Arial, sans-serif">${escapeXml(visual.type)}</text>
  </svg>`;
  return { dataURL: svgDataURL(svg), width, height };
}

// 插入文档卡片（Markdown / 表格 / 纯文本统一走文档）
export async function insertDocCard(
  api: ExcalidrawImperativeAPI,
  doc: Pick<DocumentDTO, "id" | "title" | "kind" | "contentMd">
) {
  if (doc.kind === "table") {
    await insertTableCard(api, doc);
    return;
  }
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
      roundness: null,
      roughness: 0,
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
  const rendered = renderFileCard(asset);
  const center = cascadeCenter(api, rendered.width, rendered.height);
  const fileId = crypto.randomUUID();
  api.addFiles([
    {
      id: fileId,
      dataURL: rendered.dataURL,
      mimeType: "image/svg+xml",
      created: Date.now(),
      lastRetrieved: Date.now(),
    } as any,
  ]);
  const elements = await build([
    {
      type: "image",
      fileId,
      x: center.x - rendered.width / 2,
      y: center.y - rendered.height / 2,
      width: rendered.width,
      height: rendered.height,
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
      roundness: null,
      roughness: 0,
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

// 组合卡片的数据与图片元素：整张卡是一个 image，不会散成多个可独立拖动的元素
export type CompositeCardInput = CompositeCardData;

async function buildCompositeImage(
  api: ExcalidrawImperativeAPI,
  data: CompositeCardData,
  x: number,
  y: number
) {
  const rendered = renderCompositeCard(data);
  const fileId = crypto.randomUUID();
  api.addFiles([
    {
      id: fileId,
      dataURL: rendered.dataURL,
      mimeType: "image/svg+xml",
      created: Date.now(),
      lastRetrieved: Date.now(),
    } as any,
  ]);

  const built = await build([
    {
      type: "image",
      fileId,
      x,
      y,
      width: rendered.width,
      height: rendered.height,
    },
  ]);

  const image = built[0] as any;
  image.customData = {
    mbComposite: "1",
    mbCompositeData: JSON.stringify(data),
  };
  return image;
}

// 按视口中心插入组合卡片
export async function insertCompositeCard(
  api: ExcalidrawImperativeAPI,
  input: CompositeCardInput
) {
  const rendered = renderCompositeCard(input);
  const center = cascadeCenter(api, rendered.width, rendered.height);
  const image = await buildCompositeImage(
    api,
    input,
    center.x - rendered.width / 2,
    center.y - rendered.height / 2
  );

  api.updateScene({
    elements: [...api.getSceneElements(), image] as any,
    appState: { selectedElementIds: { [image.id]: true } } as any,
    captureUpdate: "IMMEDIATELY",
  });
}

// 更新已有组合卡片：重新生成图片，并保留原位置
export async function updateCompositeCard(
  api: ExcalidrawImperativeAPI,
  elementId: string,
  input: CompositeCardInput
): Promise<boolean> {
  const elements = api.getSceneElements();
  const target = elements.find((element: any) => element.id === elementId) as any;
  if (!target) return false;

  const rendered = renderCompositeCard(input);
  const fileId = crypto.randomUUID();
  api.addFiles([
    {
      id: fileId,
      dataURL: rendered.dataURL,
      mimeType: "image/svg+xml",
      created: Date.now(),
      lastRetrieved: Date.now(),
    } as any,
  ]);

  const next = elements.map((element: any) => {
    if (element.id !== elementId) return element;
    return {
      ...element,
      fileId,
      width: rendered.width,
      height: rendered.height,
      customData: {
        ...(element.customData || {}),
        mbComposite: "1",
        mbCompositeData: JSON.stringify(input),
      },
      version: element.version + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
    };
  });

  api.updateScene({ elements: next as any, captureUpdate: "IMMEDIATELY" });
  return true;
}

// 把画布上的文字或图片收进组合卡片，吸收后原元素删除
export async function absorbElementIntoCompositeCard(
  api: ExcalidrawImperativeAPI,
  cardId: string,
  elementId: string
): Promise<boolean> {
  const elements = api.getSceneElements();
  const card = elements.find((element: any) => element.id === cardId) as any;
  const source = elements.find((element: any) => element.id === elementId) as any;
  if (!card || !source || card.id === source.id) return false;
  if (!card.customData?.mbComposite) return false;
  if (source.groupIds?.length) return false;

  const data = parseCompositeCardData(card.customData);
  if (!data) return false;

  const next: CompositeCardData = {
    ...data,
    fields: [...(data.fields || [])],
    images: [...(data.images || [])],
  };

  if (source.type === "text") {
    const value = (source.text || "").trim();
    if (!value) return false;
    next.fields = [...next.fields, value];
  } else if (source.type === "image") {
    const files = api.getFiles ? api.getFiles() : {};
    const file = files?.[source.fileId];
    if (!file?.dataURL) return false;
    next.images = [
      ...(next.images || []),
      {
        dataURL: file.dataURL,
        width: source.width,
        height: source.height,
      },
    ];
  } else {
    return false;
  }

  await updateCompositeCard(api, cardId, next);

  api.updateScene({
    elements: api
      .getSceneElements()
      .filter((element: any) => element.id !== elementId) as any,
    captureUpdate: "IMMEDIATELY",
  });
  return true;
}

// 把旧版由多个元素拼起来的组合卡片迁移成单张图片
export async function migrateCompositeCards(api: ExcalidrawImperativeAPI): Promise<number> {
  const elements = api.getSceneElements();
  const groups = new Map<string, any[]>();

  for (const element of elements as any[]) {
    if (element.type === "frame") continue;
    const groupId = element.groupIds?.[0];
    if (!groupId) continue;
    const list = groups.get(groupId) || [];
    list.push(element);
    groups.set(groupId, list);
  }

  const removals = new Set<string>();
  const replacements: any[] = [];

  for (const group of groups.values()) {
    const texts = group.filter((element) => element.type === "text");
    const meta = texts.find((element) => /^\d+\s*个字段/.test(element.text || ""));
    if (!meta) continue;

    const title = texts
      .filter((element) => element !== meta && element.y < meta.y && (element.text || "").trim())
      .sort((a, b) => (b.fontSize || 0) - (a.fontSize || 0))[0];
    if (!title) continue;

    const documentElement = group.find((element) => element.customData?.mbDocId);
    const docTitle = documentElement?.customData?.mbDocTitle;
    const wordsText = texts.find((element) => /\d+\s*字/.test(element.text || ""));
    const words = Number((wordsText?.text?.match(/(\d+)\s*字/) || [])[1] || 0);

    const fields = texts
      .filter((element) => {
        const value = (element.text || "").trim();
        if (!value) return false;
        if (element === title || element === meta || element === wordsText) return false;
        if (value === "📄") return false;
        if (docTitle && value === docTitle) return false;
        return true;
      })
      .map((element) => (element.text || "").trim());

    const minX = Math.min(...group.map((element) => element.x));
    const minY = Math.min(...group.map((element) => element.y));
    const data: CompositeCardData = {
      title: (title.text || "未命名组合").trim(),
      fields,
      document: documentElement
        ? {
            id: documentElement.customData.mbDocId,
            title: docTitle || documentElement.text || "关联文档",
            words,
          }
        : null,
    };

    const image = await buildCompositeImage(api, data, minX, minY);
    replacements.push(image);
    for (const element of group) removals.add(element.id);
  }

  if (replacements.length === 0) return 0;

  api.updateScene({
    elements: [
      ...elements.filter((element: any) => !removals.has(element.id)),
      ...replacements,
    ] as any,
    captureUpdate: "IMMEDIATELY",
  });
  return replacements.length;
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
      roughness: 0,
      roundness: null,
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
