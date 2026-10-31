import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
};

// 空状态占位
export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-14",
        className
      )}
    >
      {icon ? (
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface-2 text-muted [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </div>
      ) : null}
      <div>
        <p className="text-[13.5px] font-medium text-ink">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-5 text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
