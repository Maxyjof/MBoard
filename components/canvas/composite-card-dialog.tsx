"use client";

import { useEffect, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { CompositeCardInput } from "@/components/canvas/editor/insert";

type PanelDocument = {
  id: string;
  title: string;
};

type CompositeCardDialogProps = {
  open: boolean;
  documents: PanelDocument[];
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CompositeCardInput) => void;
};

const DEFAULT_FIELDS = ["场景：", "人物：", "情节："];

// 组合卡片：像故事卡一样把标题、字段和文档装进一个整体
export function CompositeCardDialog({
  open,
  documents,
  onOpenChange,
  onCreate,
}: CompositeCardDialogProps) {
  const [title, setTitle] = useState("1. 新故事");
  const [fields, setFields] = useState<string[]>([...DEFAULT_FIELDS]);
  const [docId, setDocId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("1. 新故事");
    setFields([...DEFAULT_FIELDS]);
    setDocId("");
    setBusy(false);
  }, [open]);

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

  async function createCard() {
    const nextTitle = title.trim();
    if (!nextTitle) {
      toast.error("请填写卡片标题");
      return;
    }

    let document: CompositeCardInput["document"] = null;
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

    onCreate({
      title: nextTitle,
      fields: fields.map((field) => field.trim()).filter(Boolean),
      document,
    });
    onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="新建组合卡片"
      description="标题、字段和关联文档会打包成一个整体，拖动时一起移动"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void createCard()} loading={busy}>
            创建卡片
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
            <label className="text-[12px] font-medium text-ink">字段</label>
            <button
              type="button"
              onClick={addField}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:text-brand/80"
              disabled={busy}
            >
              <Plus className="h-3.5 w-3.5" />
              添加字段
            </button>
          </div>
          <div className="space-y-2">
            {fields.map((field, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={field}
                  onChange={(event) => updateField(index, event.target.value)}
                  placeholder="例如：场景：宿舍"
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => removeField(index)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-danger/10 hover:text-danger"
                  aria-label="删除字段"
                  disabled={busy}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {fields.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12px] text-faint">
                还没有字段，点右上角“添加字段”
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink">关联文档</label>
          <select
            value={docId}
            onChange={(event) => setDocId(event.target.value)}
            disabled={busy}
            className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13px] text-ink outline-none transition focus:border-brand"
          >
            <option value="">不关联文档</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.title}
              </option>
            ))}
          </select>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
            <FileText className="h-3.5 w-3.5" />
            关联后卡片底部会出现文档条目，单击即可打开
          </p>
        </div>
      </div>
    </Modal>
  );
}
