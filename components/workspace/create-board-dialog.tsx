"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BoardSummary } from "@/lib/types";

const ACCENTS = ["#6353f5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];

type CreateBoardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// 新建看板：输入名称与主题色
export function CreateBoardDialog({ open, onOpenChange }: CreateBoardDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [pending, setPending] = useState(false);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || pending) return;

    setPending(true);
    try {
      const response = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed, accent }),
      });
      const data = (await response.json()) as { board?: BoardSummary; error?: string };

      if (!response.ok || !data.board) {
        toast.error(data.error || "创建看板失败");
        return;
      }

      toast.success("看板已创建");
      onOpenChange(false);
      setTitle("");
      router.push(`/boards/${data.board.id}`);
      router.refresh();
    } catch {
      toast.error("网络异常，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="新建看板"
      description="看板用于管理一类日程计划，所有成员共享"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!title.trim()}>
            创建
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
            placeholder="例如：2026 春季课程计划"
            maxLength={60}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </div>

        <div>
          <span className="mb-2 block text-[12.5px] font-medium text-ink">主题色</span>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setAccent(color)}
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition",
                  accent === color ? "border-ink/70 scale-110" : "border-transparent hover:scale-105"
                )}
                style={{ backgroundColor: color }}
                aria-label={`选择颜色 ${color}`}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
