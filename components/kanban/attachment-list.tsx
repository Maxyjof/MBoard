"use client";

// 卡片附件：上传到共享资源接口后关联卡片，支持下载与删除
import { useRef, useState } from "react";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Tip } from "@/components/ui/tip";
import {
  addAttachment,
  deleteAttachment,
  errorMessage,
  uploadAsset,
} from "@/components/kanban/kanban-api";
import type { AttachmentDTO } from "@/lib/types";

type AttachmentListProps = {
  cardId: string;
  attachments: AttachmentDTO[];
  onChange: (attachments: AttachmentDTO[]) => void;
  disabled?: boolean;
};

// 文件大小展示：B / KB / MB
function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT = "image/*,video/*,.md,.txt,application/pdf,text/markdown,text/plain";

export function AttachmentList({
  cardId,
  attachments,
  onChange,
  disabled = false,
}: AttachmentListProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const asset = await uploadAsset(file);
      const attachment = await addAttachment(cardId, asset.id);
      onChange([...attachments, attachment]);
      toast.success("附件已添加");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(attachment: AttachmentDTO) {
    if (removingId) return;
    setRemovingId(attachment.id);
    try {
      await deleteAttachment(cardId, attachment.id);
      onChange(attachments.filter((item) => item.id !== attachment.id));
      toast.success("附件已删除");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
          <Paperclip className="h-3.5 w-3.5" />
          附件
          {attachments.length > 0 ? (
            <span className="text-faint">· {attachments.length}</span>
          ) : null}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-brand transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? "上传中" : "上传"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>

      {attachments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12px] text-faint">
          暂无附件，支持图片、视频、Markdown 与 PDF
        </div>
      ) : (
        <ul className="space-y-1.5">
          {attachments.map((attachment) => {
            const isImage = attachment.mimeType.startsWith("image/");
            return (
              <li
                key={attachment.id}
                className="group flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2"
              >
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={attachment.url}
                    alt={attachment.filename}
                    className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-muted">
                    <FileText className="h-4 w-4" />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-ink" title={attachment.filename}>
                    {attachment.filename}
                  </p>
                  <p className="text-[11px] text-faint">{formatSize(attachment.size)}</p>
                </div>

                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-btn h-7 w-7"
                  aria-label="下载附件"
                  title="下载"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>

                <Tip label="删除附件">
                  <button
                    type="button"
                    className="icon-btn h-7 w-7 text-muted hover:text-danger"
                    disabled={disabled || removingId === attachment.id}
                    onClick={() => void remove(attachment)}
                    aria-label="删除附件"
                  >
                    {removingId === attachment.id ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </Tip>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
