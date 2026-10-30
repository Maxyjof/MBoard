"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MarkdownLiveEditor } from "@/components/canvas/markdown-live-editor";
import { TableEditor, isMarkdownTable } from "@/components/canvas/table-editor";
import type { DocumentDTO } from "@/lib/types";

type DocumentEditorDialogProps = {
  open: boolean;
  document: DocumentDTO | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (document: DocumentDTO) => void;
  onInsert: (document: DocumentDTO) => void;
};

type Draft = {
  id: string;
  title: string;
  content: string;
};

// 文档编辑：普通文档用实时 Markdown 编辑器，表格文档用可视化网格
export function DocumentEditorDialog({
  open,
  document,
  onOpenChange,
  onSaved,
  onInsert,
}: DocumentEditorDialogProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [inserting, setInserting] = useState(false);

  // 等文档内容准备好再挂载编辑器，避免 CodeMirror 读到空初始值
  useEffect(() => {
    if (!open || !document) {
      setDraft(null);
      return;
    }
    setDraft({
      id: document.id,
      title: document.title,
      content: document.contentMd,
    });
  }, [open, document?.id]);

  const tableMode =
    document?.kind === "table" ||
    (draft ? isMarkdownTable(draft.content) : false);

  async function save(): Promise<DocumentDTO | null> {
    if (!draft || !document) return null;
    const nextTitle = draft.title.trim();
    if (!nextTitle) {
      toast.error("文档标题不能为空");
      return null;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/documents/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle, contentMd: draft.content }),
      });
      const data = (await response.json()) as { document?: DocumentDTO; error?: string };
      if (!response.ok || !data.document) {
        toast.error(data.error || "保存失败");
        return null;
      }
      onSaved(data.document);
      toast.success("文档已保存");
      return data.document;
    } catch {
      toast.error("网络异常，保存失败");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    const saved = await save();
    if (saved) onOpenChange(false);
  }

  async function saveAndInsert() {
    if (!document) return;
    setInserting(true);
    try {
      const saved = await save();
      if (saved) {
        onInsert(saved);
        onOpenChange(false);
      }
    } finally {
      setInserting(false);
    }
  }

  return (
    <Modal
      open={open && Boolean(document)}
      onOpenChange={onOpenChange}
      size="xl"
      title={tableMode ? "编辑表格" : "编辑文档"}
      description={
        tableMode
          ? "直接编辑单元格，保存时自动转成 Markdown 表格"
          : "实时渲染 Markdown，光标所在行会显示原始语法"
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving || inserting}>
            取消
          </Button>
          <Button variant="secondary" onClick={() => void saveAndInsert()} loading={inserting}>
            <FilePlus2 className="h-3.5 w-3.5" />
            保存并插入画布
          </Button>
          <Button
            variant="primary"
            onClick={() => void saveAndClose()}
            loading={saving}
            disabled={!draft}
          >
            保存
          </Button>
        </>
      }
    >
      {draft ? (
        <div className="space-y-3">
          <Input
            value={draft.title}
            onChange={(event) =>
              setDraft((previous) =>
                previous ? { ...previous, title: event.target.value } : previous
              )
            }
            placeholder="文档标题"
            maxLength={120}
            disabled={saving || inserting}
          />

          {tableMode ? (
            <TableEditor
              key={`${draft.id}-${open}`}
              value={draft.content}
              onChange={(content) =>
                setDraft((previous) => (previous ? { ...previous, content } : previous))
              }
              disabled={saving || inserting}
              className="max-h-[58vh] overflow-y-auto pr-1"
            />
          ) : (
            <MarkdownLiveEditor
              key={`${draft.id}-${open}`}
              initialValue={draft.content}
              onChange={(content) =>
                setDraft((previous) => (previous ? { ...previous, content } : previous))
              }
              className="h-[56vh]"
              disabled={saving || inserting}
            />
          )}
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center text-[12px] text-muted">
          正在加载文档内容…
        </div>
      )}
    </Modal>
  );
}
