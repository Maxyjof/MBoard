"use client";

// 看板列表列：横向可排序，内部承载卡片并支持快速新建
import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown, MenuItem } from "@/components/ui/dropdown";
import { Spinner } from "@/components/ui/spinner";
import { CardItem } from "@/components/kanban/card-item";
import { createCard, deleteList, errorMessage, updateList } from "@/components/kanban/kanban-api";
import { cn } from "@/lib/utils";
import type { CardDTO, ListDTO, MemberDTO } from "@/lib/types";

type KanbanColumnProps = {
  list: ListDTO;
  members: MemberDTO[];
  onOpenCard: (card: CardDTO) => void;
  onCardCreated: (card: CardDTO) => void;
  onListRenamed: (listId: string, title: string) => void;
  onListRemoved: (listId: string) => void;
  disabled?: boolean;
};

export function KanbanColumn({
  list,
  members,
  onOpenCard,
  onCardCreated,
  onListRenamed,
  onListRemoved,
  disabled = false,
}: KanbanColumnProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(list.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [adding, setAdding] = useState(false);
  const [cardTitle, setCardTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const cancelEditRef = useRef(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id, data: { type: "list", listId: list.id }, disabled });

  const { setNodeRef: setZoneRef, isOver } = useDroppable({
    id: `zone:${list.id}`,
    data: { type: "zone", listId: list.id },
  });

  function startEditing() {
    cancelEditRef.current = false;
    setTitleDraft(list.title);
    setEditingTitle(true);
  }

  async function commitTitle() {
    // 按 Esc 取消时忽略输入框卸载触发的失焦提交
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      return;
    }
    if (savingTitle) return;

    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === list.title) {
      setTitleDraft(list.title);
      setEditingTitle(false);
      return;
    }

    setSavingTitle(true);
    try {
      const updated = await updateList(list.id, trimmed);
      onListRenamed(updated.id, updated.title);
      setEditingTitle(false);
      toast.success("列表已重命名");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSavingTitle(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteList(list.id);
      onListRemoved(list.id);
      setConfirmDelete(false);
      toast.success("列表已删除");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreateCard() {
    const title = cardTitle.trim();
    if (!title || creating) return;

    setCreating(true);
    try {
      const card = await createCard(list.id, title);
      onCardCreated(card);
      setCardTitle("");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <section
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(
          "flex h-full w-[84vw] max-w-[300px] shrink-0 flex-col rounded-2xl border border-line bg-surface-2/70 sm:w-[300px]",
          isDragging && "opacity-50"
        )}
      >
        <header className="flex shrink-0 items-center gap-1 border-b border-line/70 px-1.5 py-2">
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="icon-btn h-6 w-6 cursor-grab text-faint active:cursor-grabbing"
            aria-label="拖拽排序列表"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>

          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              disabled={savingTitle}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => void commitTitle()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitTitle();
                }
                if (event.key === "Escape") {
                  cancelEditRef.current = true;
                  setTitleDraft(list.title);
                  setEditingTitle(false);
                }
              }}
              className="field h-7 min-w-0 flex-1 px-2 text-[13px] font-medium"
              maxLength={40}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                startEditing();
              }}
              className="min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-left text-[13px] font-semibold text-ink transition hover:bg-surface"
              title="点击重命名列表"
            >
              {list.title}
            </button>
          )}

          <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10.5px] tabular-nums text-faint">
            {list.cards.length}
          </span>

          <Dropdown
            width={160}
            trigger={
              <button type="button" className="icon-btn h-6 w-6" aria-label="列表操作">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            }
          >
            <MenuItem
              icon={<Pencil />}
              onClick={() => {
                startEditing();
              }}
            >
              重命名列表
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger onClick={() => setConfirmDelete(true)}>
              删除列表
            </MenuItem>
          </Dropdown>
        </header>

        <div
          ref={setZoneRef}
          className={cn(
            "scroll-thin min-h-[36px] flex-1 overflow-y-auto px-2 py-1.5 transition-colors",
            isOver && "bg-brand-soft/50"
          )}
        >
          <SortableContext
            items={list.cards.map((card) => card.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {list.cards.map((card) => (
                <CardItem
                  key={card.id}
                  card={card}
                  listId={list.id}
                  members={members}
                  disabled={disabled}
                  onOpen={() => onOpenCard(card)}
                />
              ))}
              {list.cards.length === 0 ? (
                <p className="px-1 py-4 text-center text-[11.5px] text-faint">拖拽卡片到这里</p>
              ) : null}
            </div>
          </SortableContext>
        </div>

        <div className="shrink-0 p-2 pt-0">
          {adding ? (
            <div className="space-y-2 rounded-xl border border-line bg-surface p-2 shadow-card">
              <textarea
                autoFocus
                value={cardTitle}
                disabled={creating}
                onChange={(event) => setCardTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleCreateCard();
                  }
                  if (event.key === "Escape") {
                    setAdding(false);
                    setCardTitle("");
                  }
                }}
                placeholder="输入卡片标题，回车创建"
                maxLength={120}
                rows={2}
                className="w-full resize-none rounded-lg border border-line bg-surface px-2 py-1.5 text-[12.5px] leading-5 text-ink outline-none placeholder:text-faint focus:border-brand/60"
              />
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  loading={creating}
                  disabled={!cardTitle.trim()}
                  onClick={() => void handleCreateCard()}
                >
                  添加卡片
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    setCardTitle("");
                  }}
                >
                  取消
                </Button>
                {creating ? <Spinner className="ml-auto h-3.5 w-3.5" /> : null}
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              添加卡片
            </Button>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`删除列表「${list.title}」`}
        description="列表内的卡片与附件会一并删除，此操作不可撤销。"
        confirmText="删除列表"
        danger
        loading={deleting}
        onConfirm={handleDelete}
      />
    </>
  );
}
