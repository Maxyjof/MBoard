"use client";

// 标签管理：当前看板的标签表，支持新增、重命名、改色和删除
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { LABEL_PALETTE } from "@/lib/kanban";
import { cn } from "@/lib/utils";

export type BoardLabel = { id: string; name: string; color: string };

type LabelManagerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: BoardLabel[];
  onCreate: (name: string, color: string) => Promise<void>;
  onEdit: (label: BoardLabel, name: string, color: string) => Promise<void>;
  onDelete: (label: BoardLabel) => Promise<void>;
};

export function LabelManager({
  open,
  onOpenChange,
  labels,
  onCreate,
  onEdit,
  onDelete,
}: LabelManagerProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_PALETTE[0]);
  const [editing, setEditing] = useState<BoardLabel | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setEditing(null);
    setName("");
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (editing) await onEdit(editing, trimmed, color);
      else await onCreate(trimmed, color);
      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(label: BoardLabel) {
    if (busy) return;
    if (!window.confirm(`删除标签「${label.name}」？它也会从该看板所有卡片中移除。`)) return;
    setBusy(true);
    try {
      await onDelete(label);
      if (editing?.id === label.id) resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="标签管理"
      description="标签仅在当前看板使用，修改或删除会同步到该看板的卡片。"
    >
      <div className="space-y-4">
        <div className="scroll-thin max-h-[46vh] space-y-2 overflow-y-auto">
          {labels.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-muted">
              还没有标签，先在下面添加一个
            </p>
          ) : (
            labels.map((label) => (
              <div
                key={label.id}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{label.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(label);
                    setName(label.name);
                    setColor(label.color);
                  }}
                >
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void remove(label)}
                >
                  删除
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <Input
              value={name}
              maxLength={20}
              placeholder="标签名称"
              disabled={busy}
              className="h-9 flex-1"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
            <input
              type="color"
              value={color}
              disabled={busy}
              aria-label="标签颜色"
              className="h-9 w-9 cursor-pointer rounded-lg border border-line bg-surface p-1"
              onChange={(event) => setColor(event.target.value)}
            />
            <Button size="sm" disabled={busy || !name.trim()} onClick={() => void save()}>
              {editing ? "保存" : "添加"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {LABEL_PALETTE.map((item) => (
              <button
                key={item}
                type="button"
                aria-label={`标签颜色 ${item}`}
                disabled={busy}
                onClick={() => setColor(item)}
                className={cn(
                  "h-5 w-5 rounded-full border transition",
                  color === item ? "scale-110 border-ink/60" : "border-transparent hover:scale-110"
                )}
                style={{ backgroundColor: item }}
              />
            ))}
            {editing ? (
              <Button size="sm" variant="ghost" onClick={resetForm} disabled={busy}>
                取消编辑
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
