import { Loader2 } from "lucide-react";
import { BrandMark } from "@/components/brand";

// 画布路由级加载态：服务端准备页面或首包较大时给出明确反馈
export default function CanvasLoading() {
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:px-4">
        <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-2" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-36 animate-pulse rounded bg-surface-2" />
          <div className="h-2.5 w-24 animate-pulse rounded bg-surface-2" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden h-8 w-16 animate-pulse rounded-lg bg-surface-2 sm:block" />
          <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-2" />
        </div>
      </header>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface shadow-card">
            <Loader2 className="h-5 w-5 animate-spin text-brand" />
          </div>
          <div className="text-center">
            <p className="text-[13px] font-medium text-ink">正在打开画板</p>
            <p className="mt-1 text-[11.5px] text-muted">
              首次打开需要加载画布引擎，通常几秒内完成
            </p>
          </div>
          <div className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full w-1/3 animate-shimmer rounded-full bg-brand/60" />
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 flex items-center gap-2 text-[11px] text-faint">
        <BrandMark size={18} />
        MBoard
      </div>
    </div>
  );
}
