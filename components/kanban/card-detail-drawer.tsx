"use client";

// 卡片详情右侧抽屉：标题、标签、截止日期、Markdown 描述、附件、归档与删除
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Check,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { AttachmentList } from "@/components/kanban/attachment-list";
import { LabelPicker } from "@/components/kanban/label-picker";
import { MarkdownView } from "@/components/kanban/markdown-view";
import {
  deleteCard,
  errorMessage,
  updateCard,
  type CardPatch,
} from "@/components/kanban/kanban-api";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import type { CardDTO, CardLabel } from "@/lib/types";

type CardDetailDrawerProps = {
  card: CardDTO | null;
  onClose: () => void;
  onUpdated: (card: CardDTO) => void;
  onRemoved: (cardId: string) => void;
};

// ISO 时间转 input[type=date] 需要的本地日期
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function CardDetailDrawer({
  card,
  onClose,
  onUpdated,
  onRemoved,
}: CardDetailDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("preview");
  const [pendingField, setPendingField] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 切换卡片时载入草稿；同一卡片的字段更新不打断输入
  useEffect(() => {
    if (!card) return;
    setTitle(card.title);
    setDescription(card.descriptionMd);
    setTab(card.descriptionMd.trim() ? "preview" : "edit");
    setConfirmDelete(false);
  }, [card?.id]);

  // Esc 关闭并锁定背景滚动
  useEffect(() => {
    if (!card) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [card, onClose]);

  if (!mounted || !card) return null;

  const busy = pendingField !== null;
  const descriptionDirty = description !== card.descriptionMd;

  // 统一的字段更新：失败时提示并保留原值
  async function patchCard(patch: CardPatch, field: string, message?: string): Promise<boolean> {
    if (!card) return false;
    setPendingField(field);
    try {
      const updated = await updateCard(card.id, patch);
      onUpdated(updated);
      if (message) toast.success(message);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setPendingField(null);
    }
  }

  async function saveTitle() {
    if (!card) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle(card.title);
      toast.error("卡片标题不能为空");
      return;
    }
    if (trimmed === card.title) return;

    const ok = await patchCard({ title: trimmed }, "title", "标题已保存");
    if (!ok) setTitle(card.title);
  }

  async function saveDescription() {
    if (!card || !descriptionDirty) return;
    await patchCard({ descriptionMd: description }, "description", "描述已保存");
  }

  function handleLabels(next: CardLabel[]) {
    if (!card || busy) return;
    const previous = card;
    onUpdated({ ...card, labels: next });
    void patchCard({ labels: next }, "labels").then((ok) => {
      if (!ok) onUpdated(previous);
    });
  }

  function handleDueDate(value: string) {
    if (!card || busy) return;
    const previous = card;
    const dueDate = value ? new Date(`${value}T23:59:59`).toISOString() : null;
    onUpdated({ ...card, dueDate });
    void patchCard({ dueDate }, "dueDate", value ? "截止日期已设置" : "已清除截止日期").then(
      (ok) => {
        if (!ok) onUpdated(previous);
      }
    );
  }

  async function toggleArchive() {
    if (!card || busy) return;
    const archived = !card.archived;
    const ok = await patchCard(
      { archived },
      "archived",
      archived ? "卡片已归档" : "卡片已取消归档"
    );
    if (ok) onClose();
  }

  async function handleDelete() {
    if (!card || deleting) return;
    setDeleting(true);
    try {
      await deleteCard(card.id);
      onRemoved(card.id);
      setConfirmDelete(false);
      toast.success("卡片已删除");
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[110]">
      <div
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="卡片详情"
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-elevated shadow-float animate-fade-in sm:max-w-[540px]"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[12.5px] font-medium text-muted">卡片详情</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            maxLength={120}
            disabled={busy}
            className="h-11 border-transparent bg-transparent px-1 text-[17px] font-semibold shadow-none hover:border-line focus:border-brand/60"
            aria-label="卡片标题"
          />

          <section>
            <h3 className="mb-2 text-[12.5px] font-medium text-muted">标签</h3>
            <LabelPicker
              labels={card.labels}
              onChange={handleLabels}
              disabled={busy}
            />
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
              <CalendarDays className="h-3.5 w-3.5" />
              截止日期
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={toDateInput(card.dueDate)}
                onChange={(event) => handleDueDate(event.target.value)}
                disabled={busy}
                className="field h-9 w-[168px] py-0 text-[13px]"
              />
              {card.dueDate ? (
                <>
                  <span
                    className={cn(
                      "text-[12px]",
                      new Date(card.dueDate).getTime() < Date.now()
                        ? "text-danger"
                        : "text-muted"
                    )}
                  >
                    {formatDate(card.dueDate)}
                    {new Date(card.dueDate).getTime() < Date.now() ? "（已逾期）" : ""}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => handleDueDate("")}
                  >
                    清除
                  </Button>
                </>
              ) : (
                <span className="text-[12px] text-faint">未设置</span>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
                <button
                  type="button"
                  onClick={() => setTab("edit")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12px] font-medium transition",
                    tab === "edit" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                  )}
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => setTab("preview")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12px] font-medium transition",
                    tab === "preview" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                  )}
                >
                  预览
                </button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!descriptionDirty || busy}
                loading={pendingField === "description"}
                onClick={() => void saveDescription()}
              >
                {pendingField === "description" ? null : <Check className="h-3.5 w-3.5" />}
                保存
              </Button>
            </div>

            {tab === "edit" ? (
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void saveDescription();
                  }
                }}
                placeholder="支持 Markdown：标题、列表、表格、代码块…"
                rows={8}
                maxLength={50_000}
                disabled={busy}
                className="field min-h-[180px] resize-y font-mono text-[12.5px] leading-6"
              />
            ) : (
              <div className="min-h-[120px] rounded-xl border border-line bg-surface px-3 py-2.5">
                <MarkdownView content={description} />
              </div>
            )}
            <p className="mt-1 text-right text-[11px] text-faint">Ctrl / ⌘ + Enter 保存</p>
          </section>

          <AttachmentList
            cardId={card.id}
            attachments={card.attachments}
            onChange={(attachments) => onUpdated({ ...card, attachments })}
            disabled={deleting}
          />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[11px] text-faint">
            <span>创建于 {relativeTime(card.createdAt)}</span>
            <span>更新于 {relativeTime(card.updatedAt)}</span>
            {pendingField ? (
              <span className="inline-flex items-center gap-1 text-muted">
                <Spinner className="h-3 w-3" />
                保存中
              </span>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface-2/40 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={pendingField === "archived"}
            disabled={busy}
            onClick={() => void toggleArchive()}
          >
            {card.archived ? (
              <ArchiveRestore className="h-3.5 w-3.5" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
            {card.archived ? "取消归档" : "归档"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-danger/10 hover:text-danger"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
          <Button type="button" variant="secondary" size="sm" className="ml-auto" onClick={onClose}>
            关闭
          </Button>
        </footer>
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除卡片"
        description="卡片的内容与附件关联会一并删除，此操作不可撤销。"
        confirmText="删除卡片"
        danger
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>,
    document.body
  );
}
