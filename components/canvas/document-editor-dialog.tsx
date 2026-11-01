"use client";

import { useEffect, useRef, useState } from "react";
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
  tableWidths: Record<string, number>;
};

const WIDTHS_COMMENT = /\n?<!-- mboard-table-widths:(\{[^\n]*\}) -->\s*$/;

function readWidths(content: string): Record<string, number> {
  try {
    const value = JSON.parse(content.match(WIDTHS_COMMENT)?.[1] ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

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
  const [saveError, setSaveError] = useState("");
  const draftRef = useRef<Draft | null>(null);
  const savedRef = useRef("");
  const savingRef = useRef<Promise<DocumentDTO | null> | null>(null);
  const lastDocumentRef = useRef<DocumentDTO | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const serialize = (value: Draft) => JSON.stringify({
    title: value.title.trim(),
    contentMd: Object.keys(value.tableWidths).length ? `${value.content}\n<!-- mboard-table-widths:${JSON.stringify(value.tableWidths)} -->` : value.content,
  });

  // 等文档内容准备好再挂载编辑器，避免 CodeMirror 读到空初始值
  useEffect(() => {
    if (!open || !document) {
      setDraft(null);
      return;
    }
    const initial = {
      id: document.id,
      title: document.title,
      content: document.contentMd.replace(WIDTHS_COMMENT, ""),
      tableWidths: readWidths(document.contentMd),
    };
    draftRef.current = initial;
    savedRef.current = serialize(initial);
    lastDocumentRef.current = document;
    setSaveError("");
    setDraft(initial);
    setEditingTitle(false);
  }, [open, document?.id]);

  // 只有显式创建的表格文档使用网格编辑器；普通 Markdown 可以自由包含表格。
  const tableMode = document?.kind === "table";

  // Serialize requests and keep saving until the latest draft has reached the server.
  async function flush(): Promise<DocumentDTO | null> {
    if (savingRef.current) {
      const pending = await savingRef.current;
      if (!pending) return null;
    }
    const current = draftRef.current;
    if (!current) return null;
    if (!current.title.trim()) {
      setSaveError("文档标题不能为空");
      return null;
    }
    const payload = serialize(current);
    if (payload === savedRef.current) return lastDocumentRef.current;
    const request = (async () => {
      setSaving(true);
      try {
        const response = await fetch(`/api/documents/${current.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: payload,
        });
        const data = (await response.json()) as { document?: DocumentDTO; error?: string };
        if (!response.ok || !data.document) throw new Error(data.error || "保存失败");
        savedRef.current = payload;
        lastDocumentRef.current = data.document;
        onSavedRef.current(data.document);
        setSaveError("");
        return data.document;
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "网络异常，保存失败");
        return null;
      } finally {
        setSaving(false);
      }
    })();
    savingRef.current = request;
    const result = await request;
    if (savingRef.current === request) savingRef.current = null;
    if (result && draftRef.current && serialize(draftRef.current) !== savedRef.current) return flush();
    return result;
  }

  useEffect(() => {
    if (!open || !draft) return;
    draftRef.current = draft;
    if (serialize(draft) === savedRef.current) return;
    const timer = window.setTimeout(() => { void flush(); }, 800);
    return () => window.clearTimeout(timer);
  }, [draft, open]);

  useEffect(() => {
    if (!open) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (draftRef.current && serialize(draftRef.current) !== savedRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open]);

  async function close() {
    if (await flush()) onOpenChange(false);
    else toast.error("自动保存失败，请检查提示后重试");
  }

  async function saveAndInsert() {
    setInserting(true);
    try {
      const saved = await flush();
      if (saved) { onInsert(saved); onOpenChange(false); }
      else toast.error("自动保存失败，请检查提示后重试");
    } finally { setInserting(false); }
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
      onOpenChange={(nextOpen) => { if (!nextOpen) void close(); }}
      size="xl"
      className="flex h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] max-w-[min(94vw,1500px)] flex-col overflow-hidden"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-3"
      lockViewport
      centered
      footer={
        <>
          <Button variant="ghost" onClick={downloadDraft} disabled={!draft || inserting}>
            <Download className="h-3.5 w-3.5" />
            下载
          </Button>
          <span className="mr-auto text-xs text-muted" role="status">{saveError ? `保存失败：${saveError}` : saving ? "正在保存…" : "自动保存"}</span>
          <Button variant="ghost" onClick={() => void close()} disabled={inserting}>关闭</Button>
          <Button variant="secondary" onClick={() => void saveAndInsert()} loading={inserting}>
            <FilePlus2 className="h-3.5 w-3.5" />
            插入画布
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
                disabled={inserting}
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
              disabled={inserting}
              className="min-h-0 flex-1 overflow-y-auto pr-1"
            />
          ) : (
            <MarkdownLiveEditor
              key={`${draft.id}-${open}`}
              initialValue={draft.content}
              tableWidths={draft.tableWidths}
              onTableWidthsChange={(tableWidths) => setDraft((previous) => previous ? { ...previous, tableWidths } : previous)}
              onChange={(content) =>
                setDraft((previous) => (previous ? { ...previous, content } : previous))
              }
              className="h-full min-h-0 flex-1"
              disabled={inserting}
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
