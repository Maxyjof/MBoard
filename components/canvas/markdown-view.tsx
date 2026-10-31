"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// 统一的 Markdown 渲染样式
export function MarkdownView({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("prose-mb", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {content || "_暂无内容_"}
      </ReactMarkdown>
    </div>
  );
}
