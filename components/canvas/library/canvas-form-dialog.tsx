"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { CanvasSummary } from "@/lib/types";

type CanvasFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "rename";
  canvas?: CanvasSummary | null;
  // 保存成功后由父组件刷新列表
  onSaved: () => void;
};

const TITLE_MAX = 80;
const DESC_MAX = 400;

// 新建与重命名共用一套表单，降低重复代码
export function CanvasFormDialog({
  open,
  onOpenChange,
  mode,
  canvas,
  onSaved,
}: CanvasFormDialogProps) {
  const isRename = mode === "rename";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);

  // 每次打开时回填当前画板信息
  useEffect(() => {
    if (!open) return;
    setTitle(isRename ? (canvas?.title ?? "") : "");
    setDescription(isRename ? (canvas?.description ?? "") : "");
    setPending(false);
  }, [open, isRename, canvas]);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || pending) return;

    const target = isRename ? canvas : null;
    if (isRename && !target) return;

    setPending(true);
    try {
      const response = await fetch(target ? `/api/canvases/${target.id}` : "/api/canvases", {
        method: target ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed, description: description.trim() || null }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        toast.error(data.error || (isRename ? "重命名失败" : "创建画板失败"));
        return;
      }

      toast.success(isRename ? "画板已重命名" : "画板已创建");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("网络异常，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={isRename ? "重命名画板" : "新建画板"}
      description={
        isRename ? "修改后的名称对所有成员可见" : "创建后即可自由绘制，所有登录成员共享编辑"
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!title.trim()}>
            {isRename ? "保存" : "创建"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium text-ink" htmlFor="canvas-title">
            画板名称
          </label>
          <Input
            id="canvas-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：产品流程图"
            maxLength={TITLE_MAX}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium text-ink" htmlFor="canvas-desc">
            画板描述
            <span className="ml-1 font-normal text-faint">（可选）</span>
          </label>
          <Textarea
            id="canvas-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="一句话说明这块画板要做什么"
            maxLength={DESC_MAX}
            rows={3}
          />
          <p className="mt-1 text-right text-[11px] tabular-nums text-faint">
            {description.length}/{DESC_MAX}
          </p>
        </div>
      </div>
    </Modal>
  );
}
