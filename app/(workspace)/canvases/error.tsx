"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// 画板库异常兜底：提供重试入口，避免整页白屏
export default function CanvasesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <EmptyState
        icon={<AlertTriangle />}
        title="画板库加载失败"
        description="网络或服务端出了点问题，稍后重试即可"
        action={
          <Button variant="secondary" onClick={() => reset()}>
            重试
          </Button>
        }
      />
    </div>
  );
}
