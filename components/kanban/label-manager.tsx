"use client";

// 标签管理：当前看板的标签表，支持拖拽排序、新增、重命名、改色和删除
import { useEffect, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
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
  onReorder: (ids: string[]) => Promise<void>;
};

export function LabelManager({
  open,
  onOpenChange,
  labels,
  onCreate,
  onEdit,
  onDelete,
  onReorder,
}: LabelManagerProps) {
  const [items, setItems] = useState(labels);
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_PALETTE[0]);
  const [editing, setEditing] = useState<BoardLabel | null>(null);
  const [busy, setBusy] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // 父组件里标签表变化后同步到本地排序
  useEffect(() => {
    setItems(labels);
  }, [labels]);

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

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || busy) return;
    const from = items.findIndex((label) => label.id === active.id);
    const to = items.findIndex((label) => label.id === over.id);
    if (from < 0 || to < 0) return;

    const next = arrayMove(items, from, to);
    setItems(next);
    try {
      await onReorder(next.map((label) => label.id));
    } catch (error) {
      setItems(labels);
      toast.error(error instanceof Error ? error.message : "排序保存失败");
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="标签管理"
      description="拖动左侧手柄调整顺序。标签仅在当前看板使用，修改或删除会同步到该看板的卡片。"
    >
      <div className="space-y-4">
        <div className="scroll-thin max-h-[46vh] space-y-2 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-muted">
              还没有标签，先在下面添加一个
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext
                items={items.map((label) => label.id)}
                strategy={verticalListSortingStrategy}
              >
                {items.map((label) => (
                  <SortableLabelRow
                    key={label.id}
                    label={label}
                    disabled={busy}
                    onEdit={() => {
                      setEditing(label);
                      setName(label.name);
                      setColor(label.color);
                    }}
                    onDelete={() => void remove(label)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="space-y-2.5 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <Input
              value={name}
              maxLength={20}
              placeholder="标签名称"
              disabled={busy}
              className="h-9 min-w-0 flex-1"
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
              title="自定义颜色"
              className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-surface p-1"
              onChange={(event) => setColor(event.target.value)}
            />
            <Button
              size="sm"
              className="shrink-0 whitespace-nowrap"
              disabled={busy || !name.trim()}
              onClick={() => void save()}
            >
              {editing ? "保存" : "添加"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-faint">常用颜色</span>
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
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto shrink-0 whitespace-nowrap"
                onClick={resetForm}
                disabled={busy}
              >
                取消编辑
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

type SortableLabelRowProps = {
  label: BoardLabel;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

// 单行标签：只有左侧手柄能拖动，避免和编辑/删除按钮抢事件
function SortableLabelRow({ label, disabled, onEdit, onDelete }: SortableLabelRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: label.id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5",
        isDragging && "relative z-10 shadow-panel opacity-80"
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`拖拽排序 ${label.name}`}
        disabled={disabled}
        className="icon-btn h-7 w-7 shrink-0 cursor-grab touch-none text-faint active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{label.name}</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 whitespace-nowrap px-2"
        disabled={disabled}
        onClick={onEdit}
      >
        编辑
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 whitespace-nowrap px-2"
        disabled={disabled}
        onClick={onDelete}
      >
        删除
      </Button>
    </div>
  );
}
