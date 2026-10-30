"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MarkdownLiveEditor } from "@/components/canvas/markdown-live-editor";
import { TableEditor } from "@/components/canvas/table-editor";
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
  const [editingTitle, setEditingTitle] = useState(false);

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
    setEditingTitle(false);
  }, [open, document?.id]);

  // 只有显式创建的表格文档使用网格编辑器；普通 Markdown 可以自由包含表格。
  const tableMode = document?.kind === "table";

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

  // 下载当前文档内容，标题已有扩展名时沿用，否则补 .md
  function downloadDraft() {
    if (!draft) return;
    const filename = /\.[a-z0-9]{1,8}$/i.test(draft.title) ? draft.title : `${draft.title}.md`;
    const blob = new Blob([draft.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return (
    <Modal
      open={open && Boolean(document)}
      onOpenChange={onOpenChange}
      size="xl"
      className="flex h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] max-w-[min(94vw,1500px)] flex-col overflow-hidden"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-3"
      lockViewport
      centered
      footer={
        <>
          <Button variant="ghost" onClick={downloadDraft} disabled={!draft || saving || inserting}>
            <Download className="h-3.5 w-3.5" />
            下载
          </Button>
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
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="shrink-0 px-1">
            {editingTitle ? (
              <Input
                autoFocus
                value={draft.title}
                onChange={(event) =>
                  setDraft((previous) =>
                    previous ? { ...previous, title: event.target.value } : previous
                  )
                }
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setEditingTitle(false);
                  }
                  if (event.key === "Escape") {
                    setDraft((previous) =>
                      previous ? { ...previous, title: document?.title ?? previous.title } : previous
                    );
                    setEditingTitle(false);
                  }
                }}
                placeholder="文件名"
                maxLength={120}
                disabled={saving || inserting}
              />
            ) : (
              <button
                type="button"
                data-skip-autofocus
                className="max-w-full truncate rounded-lg px-1 text-left text-[15px] font-medium text-ink hover:bg-surface-2"
                onDoubleClick={() => setEditingTitle(true)}
                title="双击修改文件名"
              >
                {draft.title || "未命名文档"}
              </button>
            )}
          </div>

          {tableMode ? (
            <TableEditor
              key={`${draft.id}-${open}`}
              value={draft.content}
              onChange={(content) =>
                setDraft((previous) => (previous ? { ...previous, content } : previous))
              }
              disabled={saving || inserting}
              className="min-h-0 flex-1 overflow-y-auto pr-1"
            />
          ) : (
            <MarkdownLiveEditor
              key={`${draft.id}-${open}`}
              initialValue={draft.content}
              onChange={(content) =>
                setDraft((previous) => (previous ? { ...previous, content } : previous))
              }
              className="h-full min-h-0 flex-1"
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
