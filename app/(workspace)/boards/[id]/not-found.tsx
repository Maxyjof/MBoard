import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

// 看板不存在或已被删除
export default function BoardNotFound() {
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <EmptyState
        icon={<SearchX />}
        title="看板不存在"
        description="它可能已被删除，或者链接地址有误。"
        action={
          <Link
            href="/boards"
            className="inline-flex h-8 items-center justify-center rounded-lg bg-brand px-3 text-[13px] font-medium text-brand-ink shadow-sm transition hover:bg-brand/90"
          >
            返回看板
          </Link>
        }
      />
    </div>
  );
}
