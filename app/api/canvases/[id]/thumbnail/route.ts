import { prisma } from "@/lib/prisma";
import { fail, notFound, ok, serverError, withSession } from "@/lib/http";
import { MAX_THUMBNAIL_BYTES, removeAsset, saveAsset, UploadError } from "@/lib/assets";

type RouteContext = { params: Promise<{ id: string }> };

// 上传画板缩略图：仅接受 PNG，≤2MB，成功后更新 thumbnailAssetId
export async function POST(request: Request, { params }: RouteContext) {
  return withSession(async (session) => {
    const { id } = await params;

    let canvas: { id: string; thumbnailAssetId: string | null } | null = null;
    try {
      canvas = await prisma.canvas.findUnique({
        where: { id },
        select: { id: true, thumbnailAssetId: true },
      });
    } catch (error) {
      return serverError(error);
    }
    if (!canvas) return notFound("画板不存在");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail("请求必须是 multipart/form-data 格式");
    }

    const file = form.get("file");
    if (!(file instanceof File)) return fail("请选择要上传的缩略图");

    // 先给出明确的格式提示，再走统一的资源校验
    if (file.type.split(";")[0].trim().toLowerCase() !== "image/png") {
      return fail("缩略图必须是 PNG 格式");
    }

    try {
      const asset = await saveAsset({
        file,
        kind: "thumbnail",
        maxBytes: MAX_THUMBNAIL_BYTES,
        // 契约要求缩略图必须是 PNG
        allowMime: (mime) => mime === "image/png",
      });

      await prisma.canvas.update({
        where: { id },
        data: { thumbnailAssetId: asset.id, lastEditor: session.displayName },
      });

      // 旧缩略图已无引用，顺手清掉避免磁盘堆积
      const previous = canvas.thumbnailAssetId;
      if (previous && previous !== asset.id) {
        await removeAsset(previous).catch(() => undefined);
      }

      return ok({ url: asset.url });
    } catch (error) {
      if (error instanceof UploadError) return fail(error.message, error.status);
      return serverError(error);
    }
  });
}
