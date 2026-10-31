"use client";

// 操作记录：查看全站最近 30 天的内容变更，只能撤销/重做自己的操作
import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Tip } from "@/components/ui/tip";
import { cn, relativeTime } from "@/lib/utils";

type Operation = {
  id: string;
  actor: string;
  title: string;
  undone: boolean;
  createdAt: string;
};

type WorkHistoryProps = {
  collapsed?: boolean;
};

export function WorkHistory({ collapsed = false }: WorkHistoryProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Operation[]>([]);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function show() {
    setLoading(true);
    try {
      const response = await fetch("/api/history");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载操作记录失败");
      setRows(data.operations);
      setUsername(data.username);
      setOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载操作记录失败");
    } finally {
      setLoading(false);
    }
  }

  async function act(row: Operation) {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, redo: row.undone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作失败");
      toast.success(row.undone ? "已重做" : "已撤销");
      // 通知当前页面的看板组件重新拉取数据，再做一次服务端组件刷新
      window.dispatchEvent(new Event("mboard:history-changed"));
      router.refresh();
      await show();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  const trigger = (
    <button
      type="button"
      onClick={() => void show()}
      disabled={loading}
      aria-label="操作记录"
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-60",
        collapsed && "w-9 justify-center px-0"
      )}
    >
      <History className="h-4 w-4" />
      {collapsed ? null : <span>操作记录</span>}
    </button>
  );

  return (
    <>
      {collapsed ? <Tip label="操作记录">{trigger}</Tip> : trigger}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="操作记录"
        description="保留最近 30 天。每个人只能撤销自己的操作，涉及他人后续修改时会拒绝执行。"
      >
        <div className="scroll-thin max-h-[60vh] space-y-2 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-muted">还没有可撤销的操作</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-line px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-ink">{row.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-faint">
                    {row.actor} · {relativeTime(new Date(row.createdAt))}
                    {row.undone ? " · 已撤销" : ""}
                  </p>
                </div>
                {row.actor === username ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busyId === row.id}
                    disabled={busyId !== null}
                    onClick={() => void act(row)}
                  >
                    {row.undone ? "重做" : "撤销"}
                  </Button>
                ) : (
                  <Tip label="只能撤销自己的操作">
                    <span className="flex items-center gap-1 text-[11px] text-faint">
                      <Lock className="h-3 w-3" />
                      仅本人
                    </span>
                  </Tip>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
