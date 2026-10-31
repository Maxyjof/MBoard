import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-brand-ink shadow-sm hover:bg-brand/90 active:bg-brand/95 disabled:bg-brand/50",
  secondary:
    "bg-surface-2 text-ink border border-line hover:bg-elevated hover:border-ink/10 disabled:opacity-60",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50",
  outline: "border border-line bg-surface text-ink hover:bg-surface-2 disabled:opacity-60",
  danger: "bg-danger text-white shadow-sm hover:bg-danger/90 disabled:opacity-60",
  subtle: "bg-brand/10 text-brand hover:bg-brand/15 disabled:opacity-60",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[13px]",
  md: "h-9 gap-2 rounded-xl px-3.5 text-[13.5px]",
  lg: "h-11 gap-2 rounded-xl px-5 text-sm",
  icon: "h-9 w-9 rounded-xl",
  "icon-sm": "h-8 w-8 rounded-lg",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

// 通用按钮：统一圆角/间距/焦点态，loading 时禁用并显示转圈
export function Button({
  className,
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center font-medium transition-colors focus-visible:outline-none disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}
