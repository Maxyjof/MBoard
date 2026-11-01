"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type Vditor from "vditor";

type MarkdownLiveEditorProps = {
  initialValue: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
};

export function MarkdownLiveEditor({ initialValue, onChange, className, disabled = false }: MarkdownLiveEditorProps) {
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

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !(editor as any).vditor) return;
    if (disabled) editor.disabled();
    else editor.enable();
  }, [disabled]);

  return <div ref={containerRef} className={cn("vditor-mb min-h-[360px] min-w-0 overflow-hidden rounded-xl border border-line", className)} />;
}
