"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type Vditor from "vditor";

type MarkdownLiveEditorProps = {
  initialValue: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  tableWidths?: Record<string, number>;
  onTableWidthsChange?: (widths: Record<string, number>) => void;
};

export function MarkdownLiveEditor({ initialValue, onChange, className, disabled = false, tableWidths, onTableWidthsChange }: MarkdownLiveEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Vditor | null>(null);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  onChangeRef.current = onChange;
  disabledRef.current = disabled;

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let editor: Vditor | null = null;
    let initialized = false;

    const destroyEditor = (target: Vditor | null) => {
      const internal = target && (target as any).vditor;
      if (!target || !internal?.element) return;
      try {
        target.destroy();
      } catch {
        // Vditor can finish a partial async initialization after React unmounts.
      }
    };

    void import("vditor").then(({ default: VditorClass }) => {
      if (disposed || !containerRef.current) return;
      editor = new VditorClass(containerRef.current, {
      value: initialValue,
      mode: "wysiwyg",
      height: "100%",
      minHeight: 360,
      lang: "zh_CN",
      cdn: "/mboard/vditor",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "classic",
      icon: "ant",
      cache: { enable: false },
      tab: "    ",
      placeholder: "开始编写 Markdown…",
      // 不传 toolbar，让 Vditor 使用官方完整工具栏配置。
      toolbarConfig: { pin: true, hide: false },
      preview: { markdown: { toc: true, autoSpace: true } },
      outline: { enable: true, position: "left" },
      after() {
        initialized = true;
        if (disposed) {
          destroyEditor(editor);
          return;
        }
        const current = editorRef.current;
        if (!current || !(current as any).vditor) return;
        if (disabledRef.current) current.disabled();
      },
      input(value) {
        // Vditor 在部分 blur、禁用切换或重建场景中会以空串回调 input。
        // 这里用实例的真实内容做交叉校验：实例里还有内容时，忽略这次空值回调，避免已有内容被误清空。
        if (!value) {
          let actual = "";
          try {
            const current = editorRef.current as any;
            actual = current && typeof current.getValue === "function" ? current.getValue() : "";
          } catch {
            actual = "";
          }
          if (actual && actual.trim()) return;
        }
        onChangeRef.current(value);
      },
      });
      editorRef.current = editor;
      if (disposed) destroyEditor(editor);
    });
    return () => {
      disposed = true;
      if (initialized) destroyEditor(editorRef.current || editor);
      editorRef.current = null;
    };
    // 父组件通过 key 在切换文档时重建编辑器，避免输入中重建导致光标跳动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const widthsRef = useRef(tableWidths ?? {});
  const widthsChangeRef = useRef(onTableWidthsChange);
  widthsChangeRef.current = onTableWidthsChange;

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !onTableWidthsChange) return;
    const scope = `mb-${Math.random().toString(36).slice(2)}`;
    root.dataset.resizeScope = scope;
    const style = document.createElement("style");
    document.head.appendChild(style);
    const refresh = () => {
      root.querySelectorAll<HTMLTableElement>(".vditor-wysiwyg table").forEach((table, index) => {
        if (table.dataset.mbTable !== String(index)) table.dataset.mbTable = String(index);
      });
      const rules = Object.entries(widthsRef.current).map(([key, width]) => {
        if (!/^\d+:\d+$/.test(key) || typeof width !== "number" || !Number.isFinite(width)) return "";
        const [table, column] = key.split(":").map(Number);
        const px = Math.min(2000, Math.max(48, width));
        return `[data-resize-scope="${scope}"] table[data-mb-table="${table}"] tr > :nth-child(${column + 1}) { box-sizing: border-box; min-width: ${px}px; max-width: ${px}px; width: ${px}px; }`;
      }).join("\n");
      if (style.textContent !== rules) style.textContent = rules;
    };
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true });
    let drag: { x: number; width: number; key: string; pointer: number } | null = null;
    const down = (event: PointerEvent) => {
      if (disabledRef.current || event.button !== 0) return;
      const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>(".vditor-wysiwyg th, .vditor-wysiwyg td");
      if (!cell || Math.abs(event.clientX - cell.getBoundingClientRect().right) > 7) return;
      const table = cell.closest("table");
      if (!table) return;
      refresh();
      drag = { x: event.clientX, width: cell.getBoundingClientRect().width, key: `${table.dataset.mbTable}:${cell.cellIndex}`, pointer: event.pointerId };
      event.preventDefault(); event.stopPropagation();
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      widthsRef.current = { ...widthsRef.current, [drag.key]: Math.min(2000, Math.max(48, Math.round(drag.width + event.clientX - drag.x))) };
      refresh();
      event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      drag = null;
      widthsChangeRef.current?.(widthsRef.current);
    };
    root.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    refresh();
    return () => { observer.disconnect(); style.remove(); delete root.dataset.resizeScope; root.removeEventListener("pointerdown", down, true); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [onTableWidthsChange !== undefined]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !(editor as any).vditor) return;
    if (disabled) editor.disabled();
    else editor.enable();
  }, [disabled]);

  return <div ref={containerRef} className={cn("vditor-mb min-h-[360px] min-w-0 overflow-hidden rounded-xl border border-line", className)} />;
}
