import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// 通用加载指示
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-muted", className)} />;
}

// 页面级加载骨架
export function PageLoading({ label = "加载中" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}
