// 组合卡片的数据与 SVG 渲染：卡片是一张图片，不会散成多个元素
export type CompositeCardDocument = {
  id: string;
  title: string;
  words?: number;
};

export type CompositeCardImage = {
  dataURL: string;
  width: number;
  height: number;
};

export type CompositeCardData = {
  title: string;
  fields: string[];
  images?: CompositeCardImage[];
  documents?: CompositeCardDocument[];
  /** 兼容早期只关联一个文档的卡片数据 */
  document?: CompositeCardDocument | null;
};

export const COMPOSITE_CARD_WIDTH = 420;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Excalidraw 的 addFiles() 会按 Base64 Data URL 读取图片，不能直接传 URL 编码的 SVG。
function svgToDataURL(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export function compositeCardHeight(
  fields: number,
  documents: number,
  images = 0
): number {
  return 100 + fields * 64 + images * 142 + documents * 72 + 20;
}

export function getCompositeCardDocuments(data: CompositeCardData): CompositeCardDocument[] {
  if (Array.isArray(data.documents)) return data.documents;
  return data.document ? [data.document] : [];
}

export function renderCompositeCard(data: CompositeCardData): {
  svg: string;
  dataURL: string;
  width: number;
  height: number;
} {
  const width = COMPOSITE_CARD_WIDTH;
  const fields = data.fields.filter((field) => field.trim());
  const images = data.images || [];
  const documents = getCompositeCardDocuments(data);
  const height = compositeCardHeight(fields.length, documents.length, images.length);
  const meta = `${fields.length} 个字段${images.length ? ` · ${images.length} 张图片` : ""}${
    documents.length ? ` · ${documents.length} 个文档` : ""
  }`;
  const rows: string[] = [];

  fields.forEach((field, index) => {
    const rowY = 96 + index * 64;
    rows.push(`
      <rect x="20" y="${rowY}" width="${width - 40}" height="56" rx="8" fill="#ffffff" stroke="#e9ecef" stroke-width="1"/>
      <text x="36" y="${rowY + 34}" font-size="14" fill="#343a40">${escapeXml(field)}</text>
    `);
  });

  images.forEach((image, index) => {
    const rowY = 96 + fields.length * 64 + index * 142;
    rows.push(`
      <rect x="20" y="${rowY}" width="${width - 40}" height="130" rx="8" fill="#ffffff" stroke="#e9ecef" stroke-width="1"/>
      <image x="28" y="${rowY + 8}" width="${width - 56}" height="114" preserveAspectRatio="xMidYMid meet" href="${escapeXml(
        image.dataURL
      )}"/>
    `);
  });

  if (documents.length) {
    const docsStartY = 96 + fields.length * 64 + images.length * 142 + 8;
    documents.forEach((document, index) => {
      const docY = docsStartY + index * 72;
    rows.push(`
      <rect x="20" y="${docY}" width="${width - 40}" height="64" rx="8" fill="#f8f9fa" stroke="#e9ecef" stroke-width="1"/>
      <g transform="translate(36 ${docY + 16})">
        <rect width="24" height="30" rx="3" fill="#ffffff" stroke="#adb5bd" stroke-width="1"/>
        <path d="M6 8h12M6 13h12M6 18h8" stroke="#adb5bd" stroke-width="1.2" stroke-linecap="round"/>
      </g>
      <text x="72" y="${docY + 27}" font-size="14" fill="#343a40">${escapeXml(
        truncate(document.title, 24)
      )}</text>
      <text x="72" y="${docY + 47}" font-size="11" fill="#868e96">${
        document.words ?? 0
      } 字 · 点击卡片编辑</text>
    `);
    });
  } else {
    rows.push(`
      <text x="${width / 2}" y="${height - 18}" font-size="11" fill="#adb5bd" text-anchor="middle">点击卡片继续添加成员</text>
    `);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="16" fill="#ffffff" stroke="#dee2e6" stroke-width="1.5"/>
    <text x="${width / 2}" y="46" font-size="22" font-weight="600" fill="#1e1e1e" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
      data.title || "未命名组合"
    )}</text>
    <text x="${width / 2}" y="72" font-size="12" fill="#868e96" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
      meta
    )}</text>
    <g font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${rows.join("")}</g>
  </svg>`;

  return {
    svg,
    dataURL: svgToDataURL(svg),
    width,
    height,
  };
}

export function parseCompositeCardData(customData: unknown): CompositeCardData | null {
  const record = customData as { mbCompositeData?: unknown } | null;
  if (!record?.mbCompositeData) return null;
  try {
    const data =
      typeof record.mbCompositeData === "string"
        ? (JSON.parse(record.mbCompositeData) as CompositeCardData)
        : (record.mbCompositeData as CompositeCardData);
    if (!data || typeof data.title !== "string" || !Array.isArray(data.fields)) return null;
    const documents = Array.isArray(data.documents)
      ? data.documents
      : data.document
        ? [data.document]
        : [];
    return { ...data, documents };
  } catch {
    return null;
  }
}
