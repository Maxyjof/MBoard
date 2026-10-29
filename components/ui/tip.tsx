import { cn } from "@/lib/utils";

type TipProps = {
  label: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "right";
  className?: string;
};

// 纯 CSS 悬浮提示，不引入额外依赖
export function Tip({ label, children, side = "top", className }: TipProps) {
  const position =
    side === "bottom"
      ? "top-full mt-1.5 left-1/2 -translate-x-1/2"
      : side === "right"
        ? "left-full ml-2 top-1/2 -translate-y-1/2"
        : "bottom-full mb-1.5 left-1/2 -translate-x-1/2";

  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-[80] whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover/tip:opacity-100 dark:bg-slate-100 dark:text-slate-900",
          position
        )}
      >
        {label}
      </span>
    </span>
  );
}
