"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  hideClose?: boolean;
  className?: string;
};

const sizes = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl",
};

// 轻量弹窗：Portal + 遮罩 + Esc 关闭 + 滚动锁定
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  hideClose = false,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    // 打开时把焦点移进面板，方便键盘操作
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        "input, textarea, select, button:not([data-skip-autofocus])"
      );
      focusable?.focus();
    }, 30);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto p-4 pt-[10vh] sm:p-6 sm:pt-[12vh]">
      <div
        className="fixed inset-0 bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 w-full rounded-2xl border border-line bg-elevated shadow-float animate-scale-in",
          sizes[size],
          className
        )}
      >
        {!hideClose && (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="icon-btn absolute right-3 top-3 z-10"
            aria-label="关闭"
            data-skip-autofocus
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {(title || description) && (
          <div className="border-b border-line px-5 pb-4 pt-5 pr-12">
            {title ? <h2 className="text-[15px] font-semibold text-ink">{title}</h2> : null}
            {description ? (
              <p className="mt-1 text-[12.5px] leading-5 text-muted">{description}</p>
            ) : null}
          </div>
        )}

        <div className={cn("px-5 py-4", !title && !description && "pt-5")}>{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
