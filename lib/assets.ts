import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import type { AssetDTO } from "@/lib/types";

// 单文件大小上限：普通资源 50MB，画板缩略图 2MB
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

// 允许的资源种类
export const ASSET_KINDS = ["image", "video", "markdown", "file", "thumbnail"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

// 上传校验失败，路由层据此返回 400
export class UploadError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

// mime 与落盘扩展名的对应关系，未知类型回退到原文件扩展名
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "application/pdf": ".pdf",
  "text/markdown": ".md",
  "text/plain": ".txt",
};

// mime 归一化：去掉参数并统一 markdown 别名
function normalizeMime(mime: string): string {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  if (base === "text/x-markdown") return "text/markdown";
  if (base === "application/x-markdown") return "text/markdown";
  return base;
}

// 白名单：图片、视频、Markdown、纯文本、PDF
export function isAllowedMime(mime: string): boolean {
  const value = normalizeMime(mime);
  return (
    value.startsWith("image/") ||
    value.startsWith("video/") ||
    value === "text/markdown" ||
    value === "text/plain" ||
    value === "application/pdf"
  );
}

// 未显式传 kind 时按 mime 推断
export function inferKind(mime: string): AssetKind {
  const value = normalizeMime(mime);
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value === "text/markdown") return "markdown";
  return "file";
}

function normalizeKind(kind: string | null | undefined): AssetKind | null {
  if (!kind) return null;
  return (ASSET_KINDS as readonly string[]).includes(kind) ? (kind as AssetKind) : null;
}

// 保留可读文件名，但只用于展示与下载头，落盘一律用随机名
export function sanitizeFilename(name: string): string {
  const base = path.basename(name || "").replace(/[\\/:*?"<>|\r\n\t]/g, "_").trim();
  return (base || "未命名文件").slice(0, 160);
}

function extensionFor(mime: string, filename: string): string {
  const fromName = path.extname(filename || "").toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(fromName) && fromName !== ".html" && fromName !== ".htm") {
    return fromName;
  }
  return EXTENSION_BY_MIME[mime] ?? ".bin";
}

// 上传目录：UPLOAD_DIR 相对项目根目录，缺省 ./data/uploads
export function resolveUploadDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim() || "./data/uploads";
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

export async function ensureUploadDir(): Promise<string> {
  const dir = resolveUploadDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

// 落盘路径安全校验：拒绝绝对路径、空名与 .. 穿越
export function resolveStoragePath(storageKey: string): string | null {
  if (!storageKey || storageKey.includes("\0") || path.isAbsolute(storageKey)) return null;

  const dir = resolveUploadDir();
  const target = path.resolve(dir, storageKey);
  const relative = path.relative(dir, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;

  return target;
}

export function assetUrl(assetId: string | null | undefined): string | null {
  return assetId ? `/api/assets/${assetId}` : null;
}

type AssetRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: string;
};

export function toAssetDTO(asset: AssetRow): AssetDTO {
  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    size: asset.size,
    kind: asset.kind,
    url: `/api/assets/${asset.id}`,
  };
}

type SaveAssetOptions = {
  file: File;
  kind?: string | null;
  maxBytes?: number;
  // 额外的 mime 限制，例如缩略图只允许 PNG
  allowMime?: (mime: string) => boolean;
};

// 校验并保存上传文件，返回落库后的资源 DTO
export async function saveAsset(options: SaveAssetOptions): Promise<AssetDTO> {
  const { file, kind, maxBytes = MAX_ASSET_BYTES, allowMime } = options;

  const mimeType = normalizeMime(file.type);
  if (!mimeType) throw new UploadError("无法识别文件类型，请重新选择");
  if (!isAllowedMime(mimeType) || (allowMime && !allowMime(mimeType))) {
    throw new UploadError("不支持的文件类型，仅支持图片、视频、Markdown、纯文本与 PDF");
  }
  if (file.size <= 0) throw new UploadError("文件内容为空");
  if (file.size > maxBytes) throw new UploadError(`文件不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) throw new UploadError("文件内容为空");
  if (buffer.byteLength > maxBytes) {
    throw new UploadError(`文件不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`);
  }

  // 先确保目录存在，再写入随机文件名
  const dir = await ensureUploadDir();
  const storageKey = `${randomUUID()}${extensionFor(mimeType, file.name)}`;
  const absolutePath = path.join(dir, storageKey);
  await writeFile(absolutePath, buffer);

  try {
    const asset = await prisma.asset.create({
      data: {
        filename: sanitizeFilename(file.name),
        mimeType,
        size: buffer.byteLength,
        storageKey,
        kind: normalizeKind(kind) ?? inferKind(mimeType),
      },
      select: { id: true, filename: true, mimeType: true, size: true, kind: true },
    });
    return toAssetDTO(asset);
  } catch (error) {
    // 落库失败时删掉刚写入的孤儿文件
    await unlink(absolutePath).catch(() => undefined);
    throw error;
  }
}

// 按 storageKey 读取文件内容，文件缺失返回 null
export async function readStoredAsset(storageKey: string): Promise<Buffer | null> {
  const target = resolveStoragePath(storageKey);
  if (!target) return null;

  try {
    return await readFile(target);
  } catch {
    return null;
  }
}

// 删除资源：先删文件再删记录，失败时只记录日志不阻断业务
export async function removeAsset(assetId: string): Promise<void> {
  const asset = await prisma.asset
    .findUnique({ where: { id: assetId }, select: { storageKey: true } })
    .catch(() => null);

  if (asset) {
    const target = resolveStoragePath(asset.storageKey);
    if (target) await unlink(target).catch(() => undefined);
  }

  await prisma.asset.delete({ where: { id: assetId } }).catch(() => undefined);
}
