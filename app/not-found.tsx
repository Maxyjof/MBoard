import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { BrandMark } from "@/components/brand";

// 全局 404：保持与工作台一致的视觉语言
export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-bg px-6 text-center">
      <div className="mesh pointer-events-none absolute inset-0 opacity-40" />
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-30" />

      <div className="relative z-10 flex flex-col items-center">
        <BrandMark size={44} />
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.3em] text-faint">
          404 · Not Found
        </p>
        <h1 className="mt-3 text-[26px] font-semibold tracking-tight text-ink">这个页面不在画布上</h1>
        <p className="mt-2 max-w-sm text-[13px] leading-6 text-muted">
          链接可能已失效，或者对应的看板、画板已经被删除。回到工作台继续。
        </p>

        <div className="mt-7 flex items-center gap-2">
          <Link
            href="/boards"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-[13px] font-medium text-white transition hover:bg-brand/90"
          >
            <ArrowLeft className="h-4 w-4" />
            返回看板
          </Link>
          <Link
            href="/canvases"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-medium text-ink transition hover:bg-surface-2"
          >
            <Compass className="h-4 w-4" />
            浏览画板库
          </Link>
        </div>
      </div>
    </div>
  );
}
