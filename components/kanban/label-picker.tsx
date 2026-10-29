"use client";

// 标签选择器：预设标签一键切换，也支持自定义名称与颜色
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LABEL_PALETTE,
  LABEL_PRESETS,
  MAX_LABELS,
  labelStyle,
} from "@/lib/kanban";
import { cn } from "@/lib/utils";
import type { CardLabel } from "@/lib/types";

type LabelPickerProps = {
  labels: CardLabel[];
  onChange: (labels: CardLabel[]) => void;
  disabled?: boolean;
};

export function LabelPicker({ labels, onChange, disabled = false }: LabelPickerProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_PALETTE[0]);

  const hasLabel = (label: CardLabel) => labels.some((item) => item.name === label.name);

  // 同名标签视为切换：已存在则移除，否则新增
  function toggle(label: CardLabel) {
    if (disabled) return;
    if (hasLabel(label)) {
      onChange(labels.filter((item) => item.name !== label.name));
      return;
    }
    if (labels.length >= MAX_LABELS) {
      toast.error(`最多添加 ${MAX_LABELS} 个标签`);
      return;
    }
    onChange([...labels, label]);
  }

  function addCustom() {
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) return;
    if (hasLabel({ name: trimmed, color })) {
      toast.error("标签已存在");
      return;
    }
    if (labels.length >= MAX_LABELS) {
      toast.error(`最多添加 ${MAX_LABELS} 个标签`);
      return;
    }
    onChange([...labels, { name: trimmed, color }]);
    setName("");
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.length === 0 ? (
          <span className="text-[12px] text-faint">暂无标签</span>
        ) : (
          labels.map((label) => (
            <button
              key={label.name}
              type="button"
              disabled={disabled}
              onClick={() => toggle(label)}
              style={labelStyle(label.color)}
              className="chip border pr-1.5 transition hover:opacity-80 disabled:cursor-not-allowed"
            >
              {label.name}
              <X className="h-3 w-3 opacity-60" />
            </button>
          ))
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {LABEL_PRESETS.map((preset) => {
          const active = hasLabel(preset);
          return (
            <button
              key={preset.name}
              type="button"
              disabled={disabled}
              onClick={() => toggle(preset)}
              style={active ? labelStyle(preset.color) : undefined}
              className={cn(
                "chip border border-dashed border-line text-muted transition hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed",
                active && "border-solid"
              )}
            >
              {!active ? <Plus className="h-3 w-3" /> : null}
              {preset.name}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={name}
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustom();
            }
          }}
          placeholder="自定义标签"
          maxLength={20}
          className="h-8 flex-1 text-[12.5px]"
        />
        <div className="flex gap-1">
          {LABEL_PALETTE.map((item) => (
            <button
              key={item}
              type="button"
              aria-label={`颜色 ${item}`}
              disabled={disabled}
              onClick={() => setColor(item)}
              className={cn(
                "h-4 w-4 rounded-full border transition",
                color === item ? "scale-125 border-ink/60" : "border-transparent hover:scale-110"
              )}
              style={{ backgroundColor: item }}
            />
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || !name.trim()}
          onClick={addCustom}
        >
          添加
        </Button>
      </div>
    </div>
  );
}
