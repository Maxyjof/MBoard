"use client";

// 看板首页空状态：没有看板时引导创建第一个
import { useState } from "react";
import { Columns3, LayoutGrid, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateBoardDialog } from "@/components/workspace/create-board-dialog";

const FEATURES = [
  {
    icon: <Columns3 className="h-4 w-4" />,
    title: "列表与卡片",
    description: "横向列表承载卡片，拖拽即可调整顺序与分组",
  },
  {
    icon: <Sparkles className="h-4 w-4" />,
    title: "详情与附件",
    description: "Markdown 描述、标签、截止日期与附件上传",
  },
  {
    icon: <LayoutGrid className="h-4 w-4" />,
    title: "团队共享",
    description: "所有登录成员共享同一份看板数据",
  },
];

export function BoardsEmpty() {
  const [open, setOpen] = useState(false);

  return (
    <div className="scroll-thin h-full overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mesh flex h-16 w-16 items-center justify-center rounded-3xl border border-line bg-surface text-brand shadow-card">
          <LayoutGrid className="h-7 w-7" />
        </div>

        <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink">还没有看板</h1>
        <p className="mt-2 max-w-sm text-[13px] leading-6 text-muted">
          看板用来把计划拆成列表和卡片。创建第一个看板，开始整理你的任务与日程。
        </p>

        <Button variant="primary" size="lg" className="mt-5" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          创建第一个看板
        </Button>

        <div className="mt-10 grid w-full gap-3 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-line bg-surface p-3 text-left shadow-card"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand">
                {feature.icon}
              </span>
              <p className="mt-2 text-[12.5px] font-medium text-ink">{feature.title}</p>
              <p className="mt-1 text-[11.5px] leading-5 text-muted">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>

      <CreateBoardDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
