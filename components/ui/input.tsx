import { cn } from "@/lib/utils";

// 输入框
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("field h-10", className)} {...props} />;
}

// 多行文本
export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("field min-h-[96px] resize-y leading-6", className)} {...props} />;
}
