"use client";

// 看板设置：重命名、改描述与主题色、删除看板
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { deleteBoard, errorMessage, updateBoard } from "@/components/kanban/kanban-api";
import { ACCENT_PRESETS } from "@/lib/kanban";
import { cn } from "@/lib/utils";
import type { BoardDetail } from "@/lib/types";

type BoardSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: BoardDetail;
  onUpdated: (board: BoardDetail) => void;
};

export function BoardSettingsDialog({
  open,
  onOpenChange,
  board,
  onUpdated,
}: BoardSettingsDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState(board.title);
  const [description, setDescription] = useState(board.description ?? "");
  const [accent, setAccent] = useState(board.accent);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 每次打开时同步为当前看板数据
  useEffect(() => {
    if (!open) return;
    setTitle(board.title);
    setDescription(board.description ?? "");
    setAccent(board.accent);
  }, [open, board]);

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("看板名称不能为空");
      return;
    }
    if (saving) return;

    setSaving(true);
    try {
      const updated = await updateBoard(board.id, {
        title: trimmed,
        description: description.trim() || null,
        accent,
      });
      onUpdated(updated);
      toast.success("看板已更新");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteBoard(board.id);
      setConfirmDelete(false);
      onOpenChange(false);
      toast.success("看板已删除");
      router.replace("/boards");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="看板设置"
        description="修改名称、描述与主题色，所有成员共享同一份数据"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!title.trim()}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-ink">看板名称</label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：产品需求池"
              maxLength={60}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-ink">看板描述</label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="简单说明这个看板用来做什么"
              maxLength={300}
              className="min-h-[76px]"
            />
          </div>

          <div>
            <span className="mb-2 block text-[12.5px] font-medium text-ink">主题色</span>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setAccent(color)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition",
                    accent === color ? "scale-110 border-ink/70" : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: color }}
                  aria-label={`选择颜色 ${color}`}
                />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
            <p className="text-[12.5px] font-medium text-ink">删除看板</p>
            <p className="mt-0.5 text-[11.5px] leading-5 text-muted">
              列表、卡片与附件会一并删除，且无法恢复。
            </p>
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="mt-2"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除看板
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`删除看板「${board.title}」`}
        description="看板下的所有列表与卡片都会被删除，此操作不可撤销。"
        confirmText="确认删除"
        danger
        loading={deleting}
        onConfirm={handleDelete}
      />
    </>
  );
}
