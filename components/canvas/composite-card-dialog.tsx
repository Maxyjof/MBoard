"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type {
  CompositeCardData,
  CompositeCardImage,
} from "@/components/canvas/composite-card-render";

type PanelDocument = {
  id: string;
  title: string;
};

type CompositeCardDialogProps = {
  open: boolean;
  documents: PanelDocument[];
  initial?: CompositeCardData | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CompositeCardData) => void;
  onOpenDocument?: (id: string) => void;
};

const DEFAULT_FIELDS = ["场景：", "人物：", "情节："];

// 组合卡片编辑器：创建时也能继续编辑，旧卡片点开即可追加或删除成员
export function CompositeCardDialog({
  open,
  documents,
  initial,
  onOpenChange,
  onSubmit,
  onOpenDocument,
}: CompositeCardDialogProps) {
  const [title, setTitle] = useState("1. 新故事");
  const [fields, setFields] = useState<string[]>([...DEFAULT_FIELDS]);
  const [images, setImages] = useState<CompositeCardImage[]>([]);
  const [docId, setDocId] = useState("");
  const [busy, setBusy] = useState(false);
  const editing = Boolean(initial);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title || "1. 新故事");
    setFields(
      initial?.fields?.length ? [...initial.fields] : [...DEFAULT_FIELDS]
    );
    setImages(initial?.images ? [...initial.images] : []);
    setDocId(initial?.document?.id || "");
    setBusy(false);
  }, [open, initial]);

  function updateField(index: number, value: string) {
    setFields((previous) =>
      previous.map((field, fieldIndex) => (fieldIndex === index ? value : field))
    );
  }

  function addField() {
    setFields((previous) => [...previous, ""]);
  }

  function removeField(index: number) {
    setFields((previous) => previous.filter((_, fieldIndex) => fieldIndex !== index));
  }

  function moveField(index: number, delta: number) {
    setFields((previous) => {
      const target = index + delta;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submitCard() {
    const nextTitle = title.trim();
    if (!nextTitle) {
      toast.error("请填写卡片标题");
      return;
    }

    let document: CompositeCardData["document"] = null;
    if (docId) {
      setBusy(true);
      try {
        const response = await fetch(`/api/documents/${docId}`);
        const data = (await response.json()) as {
          document?: { id: string; title: string; contentMd: string };
          error?: string;
        };
        if (!response.ok || !data.document) {
          toast.error(data.error || "读取文档失败");
          return;
        }
        document = {
          id: data.document.id,
          title: data.document.title,
          words: data.document.contentMd.replace(/\s/g, "").length,
        };
      } catch {
        toast.error("网络异常，读取文档失败");
        return;
      } finally {
        setBusy(false);
      }
    }

    onSubmit({
      title: nextTitle,
      fields: fields.map((field) => field.trim()).filter(Boolean),
      images,
      document,
    });
    onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? "编辑组合卡片" : "新建组合卡片"}
      description="标题、字段和关联文档会打包成一张卡片，只能整张移动，不会散开"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void submitCard()} loading={busy}>
            {editing ? "保存修改" : "创建卡片"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink">卡片标题</label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：1. 梦醒"
            maxLength={80}
            disabled={busy}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12px] font-medium text-ink">成员字段</label>
            <button
              type="button"
              onClick={addField}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:text-brand/80"
              disabled={busy}
            >
              <Plus className="h-3.5 w-3.5" />
              添加成员
            </button>
          </div>
          <div className="space-y-2">
            {fields.map((field, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Input
                  value={field}
                  onChange={(event) => updateField(index, event.target.value)}
                  placeholder="例如：场景：宿舍"
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => moveField(index, -1)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-30"
                  aria-label="上移成员"
                  disabled={busy || index === 0}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveField(index, 1)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-30"
                  aria-label="下移成员"
                  disabled={busy || index === fields.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeField(index)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger"
                  aria-label="删除成员"
                  disabled={busy}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {fields.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-faint">
                还没有成员，点右上角“添加成员”
              </p>
            ) : null}
          </div>
        </div>

        {images.length > 0 ? (
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-ink">图片成员</label>
            <div className="grid grid-cols-3 gap-2">
              {images.map((image, index) => (
                <div
                  key={`${image.dataURL.slice(0, 24)}-${index}`}
                  className="group relative overflow-hidden rounded-lg border border-line bg-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.dataURL}
                    alt="组合卡片图片成员"
                    className="h-20 w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setImages((previous) =>
                        previous.filter((_, itemIndex) => itemIndex !== index)
                      )
                    }
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-black/55 text-white opacity-0 transition group-hover:opacity-100"
                    aria-label="删除图片成员"
                    disabled={busy}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink">关联文档</label>
          <div className="flex items-center gap-2">
            <select
              value={docId}
              onChange={(event) => setDocId(event.target.value)}
              disabled={busy}
              className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[13px] text-ink outline-none transition focus:border-brand"
            >
              <option value="">不关联文档</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </select>
            {docId && onOpenDocument ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenDocument(docId)}
                disabled={busy}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                打开
              </Button>
            ) : null}
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
            <FileText className="h-3.5 w-3.5" />
            也可以直接把画布上的文字/图片拖到卡片上，会自动变成成员
          </p>
        </div>
      </div>
    </Modal>
  );
}
