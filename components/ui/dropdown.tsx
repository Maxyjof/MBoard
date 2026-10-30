"use client";

import { cloneElement, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type TriggerElement = React.ReactElement<React.HTMLAttributes<HTMLElement>>;

type DropdownProps = {
  trigger: TriggerElement;
  children: React.ReactNode;
  align?: "start" | "end";
  width?: number;
  className?: string;
  placement?: "bottom" | "top";
};

// 下拉菜单：点击触发器展开，点击外部/Esc 关闭
export function Dropdown({ trigger, children, align = "end", width = 190, className, placement = "bottom" }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // 把展开状态与点击注入触发器，保持按钮语义
  const cloned = cloneElement(trigger, {
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      event.stopPropagation();
      setOpen((value) => !value);
    },
  } as React.HTMLAttributes<HTMLElement>);

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      {cloned}
      {open ? (
        <div
          role="menu"
          style={{ width }}
          className={cn(
            "absolute z-50 rounded-xl border border-line bg-elevated p-1 shadow-float animate-scale-in",
            placement === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            align === "end" ? "right-0" : "left-0"
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

type MenuItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  danger?: boolean;
};

export function MenuItem({ icon, danger, className, children, ...props }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn("menu-item", danger && "menu-item-danger", className)}
      {...props}
    >
      {icon ? <span className="text-muted [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span> : null}
      {children}
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-1 border-t border-line" />;
}
