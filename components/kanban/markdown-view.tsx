// Markdown 渲染：卡片描述预览复用，样式由 globals.css 的 prose-mb 提供
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type MarkdownViewProps = {
  content: string;
  className?: string;
  emptyText?: string;
};

export function MarkdownView({ content, className, emptyText = "暂无描述" }: MarkdownViewProps) {
  if (!content.trim()) {
    return <p className="text-[12.5px] text-faint">{emptyText}</p>;
  }

  return (
    <div className={cn("prose-mb break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
