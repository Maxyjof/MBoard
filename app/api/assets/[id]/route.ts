import { prisma } from "@/lib/prisma";
import { notFound, serverError, withSession } from "@/lib/http";
import { readStoredAsset } from "@/lib/assets";

// 规范化文件名，兼容带引号与特殊字符的下载头
function contentDisposition(filename: string, inline: boolean): string {
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`;
}

// 按资源 id 返回二进制流，并带上正确的 Content-Type 与缓存策略
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withSession(async () => {
    const { id } = await params;

    let asset: { storageKey: string; mimeType: string; filename: string } | null = null;
    try {
      asset = await prisma.asset.findUnique({
        where: { id },
        select: { storageKey: true, mimeType: true, filename: true },
      });
    } catch (error) {
      return serverError(error);
    }

    if (!asset) return notFound("资源不存在");

    const buffer = await readStoredAsset(asset.storageKey);
    if (!buffer) return notFound("资源文件已丢失");

    // Buffer 转成普通 Uint8Array，确保 Response 体类型可靠
    const body = new Uint8Array(buffer.byteLength);
    body.set(buffer);

    const mimeType = asset.mimeType || "application/octet-stream";
    // SVG 可能携带脚本，强制下载避免同源内联执行
    const inline = !mimeType.includes("svg");

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(body.byteLength),
        // 文件名带随机 key，内容不可变，可长期强缓存
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": contentDisposition(asset.filename, inline),
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
