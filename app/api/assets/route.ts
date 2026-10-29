import { fail, ok, serverError, withSession } from "@/lib/http";
import { MAX_ASSET_BYTES, saveAsset, UploadError } from "@/lib/assets";

// 上传资源：multipart 表单，字段 file（必填）与 kind（可选）
export async function POST(request: Request) {
  return withSession(async () => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail("请求必须是 multipart/form-data 格式");
    }

    const file = form.get("file");
    if (!(file instanceof File)) return fail("请选择要上传的文件");

    const kindValue = form.get("kind");
    const kind = typeof kindValue === "string" ? kindValue : null;

    try {
      const asset = await saveAsset({ file, kind, maxBytes: MAX_ASSET_BYTES });
      return ok({ asset }, { status: 201 });
    } catch (error) {
      if (error instanceof UploadError) return fail(error.message, error.status);
      return serverError(error);
    }
  });
}
