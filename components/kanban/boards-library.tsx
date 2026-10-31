"use client";

// 看板库：先在这里选择看板，也可以重命名或删除
import { useState } from "react";
import Link from "next/link";
import { Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown, MenuDivider, MenuItem } from "@/components/ui/dropdown";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { BoardsEmpty } from "@/components/kanban/boards-empty";
import { CreateBoardDialog } from "@/components/workspace/create-board-dialog";
import { deleteBoard, errorMessage, updateBoard } from "@/components/kanban/kanban-api";
import { ACCENT_PRESETS } from "@/lib/kanban";
import { cn } from "@/lib/utils";

type Board = {
  id: string;
  title: string;
  description: string | null;
  accent: string;
};

export function BoardsLibrary({ boards }: { boards: Board[] }) {
  const [items, setItems] = useState(boards);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Board | null>(null);
  const [removing, setRemoving] = useState<Board | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 名字与描述草稿
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accent, setAccent] = useState(ACCENT_PRESETS[0]);

  function openRename(board: Board) {
    setEditing(board);
    setTitle(board.title);
    setDescription(board.description ?? "");
    setAccent(board.accent);
  }

  async function saveRename() {
    const trimmed = title.trim();
    if (!editing || !trimmed || saving) {
      if (!trimmed) toast.error("看板名称不能为空");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateBoard(editing.id, {
        title: trimmed,
        description: description.trim() || null,
        accent,
      });
      setItems((previous) =>
        previous.map((item) =>
          item.id === updated.id
            ? {
                id: updated.id,
                title: updated.title,
                description: updated.description,
                accent: updated.accent,
              }
            : item
        )
      );
      setEditing(null);
      toast.success("看板已更新");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeBoard() {
    if (!removing || deleting) return;
    setDeleting(true);
    try {
      await deleteBoard(removing.id);
      setItems((previous) => previous.filter((item) => item.id !== removing.id));
      setRemoving(null);
      toast.success("看板已删除");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  if (items.length === 0) return <BoardsEmpty />;

  return (
    <div className="scroll-thin h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink">看板</h1>
            <p className="mt-1 text-sm text-muted">选择看板开始工作</p>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            新建看板
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((board) => (
            <article
              key={board.id}
              className="group relative rounded-xl border border-line bg-surface p-5 shadow-card transition hover:border-brand/50"
            >
              <Link href={`/boards/${board.id}`} className="block pr-8">
                <div
                  className="mb-3 h-2 w-12 rounded-full"
                  style={{ backgroundColor: board.accent }}
                />
                <h2 className="truncate font-semibold text-ink">{board.title}</h2>
                {board.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-muted">{board.description}</p>
                ) : (
                  <p className="mt-2 text-sm text-faint">暂无描述</p>
                )}
              </Link>

              {/* 操作菜单独立于链接，避免嵌套交互元素 */}
              <div className="absolute right-3 top-3 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <Dropdown
                  width={160}
                  trigger={
                    <button
                      type="button"
                      className="icon-btn border border-line bg-surface/95"
                      aria-label={`「${board.title}」的更多操作`}
                    >
                      <Ellipsis className="h-4 w-4" />
                    </button>
                  }
                >
                  <MenuItem icon={<Pencil />} onClick={() => openRename(board)}>
                    重命名
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem icon={<Trash2 />} danger onClick={() => setRemoving(board)}>
                    删除
                  </MenuItem>
                </Dropdown>
              </div>
            </article>
          ))}
        </div>
      </div>

      <CreateBoardDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Modal
        open={editing !== null}
        onOpenChange={(value) => {
          if (!value) setEditing(null);
        }}
        title="看板设置"
        description="修改名称、描述与主题色，保存后立即生效。"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!title.trim()}
              onClick={() => void saveRename()}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-muted">名称</label>
            <Input
              value={title}
              maxLength={60}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="看板名称"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-muted">描述</label>
            <Textarea
              value={description}
              maxLength={300}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="这个看板用来做什么"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-muted">主题色</label>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-label={`主题色 ${item}`}
                  onClick={() => setAccent(item)}
                  className={cn(
                    "h-6 w-6 rounded-full border-2 transition",
                    accent === item ? "scale-110 border-ink/50" : "border-transparent"
                  )}
                  style={{ backgroundColor: item }}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(value) => {
          if (!value) setRemoving(null);
        }}
        title="删除看板"
        description={`删除「${removing?.title ?? ""}」及其全部列表、卡片和标签。删除后可以在左下角「操作记录」里撤销。`}
        confirmText="删除看板"
        danger
        loading={deleting}
        onConfirm={() => void removeBoard()}
      />
    </div>
  );
}
