"use client";

import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  Quote,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MarkdownLiveEditorProps = {
  initialValue: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
};

const HIDE_MARKERS = new Set([
  "HeaderMark",
  "QuoteMark",
  "EmphasisMark",
  "StrikethroughMark",
  "LinkMark",
  "CodeMark",
  "URL",
]);

// 只有当前编辑行显示 Markdown 标记，其他行按渲染外观展示（Obsidian Live Preview 思路）
function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const activeLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number;
    const end = state.doc.lineAt(range.to).number;
    for (let line = start; line <= end; line += 1) activeLines.add(line);
  }

  const ranges: { from: number; to: number; value: Decoration }[] = [];
  const addLine = (lineFrom: number, className: string) => {
    ranges.push({ from: lineFrom, to: lineFrom, value: Decoration.line({ class: className }) });
  };
  const addMark = (from: number, to: number, className: string) => {
    ranges.push({ from, to, value: Decoration.mark({ class: className }) });
  };

  const tree = syntaxTree(state);
  tree.iterate({
    from: view.viewport.from,
    to: view.viewport.to,
    enter: (node) => {
      const name: string = node.name;
      const startLine = state.doc.lineAt(node.from);
      const isActive = activeLines.has(startLine.number);

      const headingMatch = /^ATXHeading([1-6])$/.exec(name);
      if (headingMatch) {
        const level = Math.min(Number(headingMatch[1]), 3);
        addLine(startLine.from, `cm-md-h${level}`);
      }

      if (name === "Blockquote" || name === "FencedCode" || name === "Table") {
        const endLine = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
        for (let lineNo = startLine.number; lineNo <= endLine; lineNo += 1) {
          const line = state.doc.line(lineNo);
          if (name === "Blockquote") addLine(line.from, "cm-md-quote");
          if (name === "FencedCode") addLine(line.from, "cm-md-codeblock");
          if (name === "Table") addLine(line.from, "cm-md-table");
        }
      }

      if (name === "StrongEmphasis") addMark(node.from, node.to, "cm-md-strong");
      if (name === "Emphasis") addMark(node.from, node.to, "cm-md-em");
      if (name === "InlineCode") addMark(node.from, node.to, "cm-md-code");
      if (name === "Strikethrough") addMark(node.from, node.to, "cm-md-strike");
      if (name === "Link") addMark(node.from, node.to, "cm-md-link");

      if (!isActive && HIDE_MARKERS.has(name)) {
        const parent = node.node?.parent?.name ?? "";
        const hide =
          name === "HeaderMark" ||
          name === "QuoteMark" ||
          name === "EmphasisMark" ||
          name === "StrikethroughMark" ||
          name === "LinkMark" ||
          (name === "URL" && parent === "Link") ||
          (name === "CodeMark" && parent === "InlineCode");

        if (hide) {
          let to = node.to;
          if (name === "HeaderMark" && state.doc.sliceString(to, to + 1) === " ") to += 1;
          if (to > node.from) {
            ranges.push({ from: node.from, to, value: Decoration.replace({}) });
          }
        }
      }
    },
  });

  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(
    ranges.map((item) => item.value.range(item.from, item.to)),
    true
  );
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily:
      'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    lineHeight: "1.75",
    padding: "12px 16px",
  },
  ".cm-content": { caretColor: "rgb(99 84 246)" },
  ".cm-line": { padding: "1px 0" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(99, 84, 246, 0.04)" },
  ".cm-selectionBackground": { backgroundColor: "rgba(99, 84, 246, 0.18) !important" },
  ".cm-tooltip": { border: "1px solid rgb(228 230 236)", borderRadius: "8px" },
});

function wrapSelection(view: EditorView, before: string, after = before) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  });
  view.focus();
}

function prefixLine(view: EditorView, prefix: string) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  view.dispatch({ changes: { from: line.from, insert: prefix } });
  view.focus();
}

export function MarkdownLiveEditor({
  initialValue,
  onChange,
  className,
  disabled = false,
}: MarkdownLiveEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        editorTheme,
        livePreviewPlugin,
        EditorState.readOnly.of(disabled),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 只初始化一次，文档切换由父组件 key 控制
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withView = (action: (view: EditorView) => void) => {
    if (viewRef.current) action(viewRef.current);
  };

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-line", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line bg-surface-2/60 px-2 py-1.5">
        <ToolButton label="一级标题" onClick={() => withView((view) => prefixLine(view, "# "))}>
          <Heading1 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="二级标题" onClick={() => withView((view) => prefixLine(view, "## "))}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-line" />
        <ToolButton label="加粗" onClick={() => withView((view) => wrapSelection(view, "**"))}>
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="斜体" onClick={() => withView((view) => wrapSelection(view, "*"))}>
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="行内代码" onClick={() => withView((view) => wrapSelection(view, "`"))}>
          <Code className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          label="链接"
          onClick={() => withView((view) => wrapSelection(view, "[", "](https://)"))}
        >
          <Link2 className="h-3.5 w-3.5" />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-line" />
        <ToolButton label="无序列表" onClick={() => withView((view) => prefixLine(view, "- "))}>
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="引用" onClick={() => withView((view) => prefixLine(view, "> "))}>
          <Quote className="h-3.5 w-3.5" />
        </ToolButton>
        <span className="ml-auto pr-1 text-[10.5px] text-faint">
          选中行显示 Markdown 语法
        </span>
      </div>
      <div ref={containerRef} className="scroll-thin min-h-[360px] flex-1 overflow-auto bg-surface" />
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="icon-btn h-7 w-7"
    >
      {children}
    </button>
  );
}
