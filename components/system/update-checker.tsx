"use client";

import { useState } from "react";
import { CircleCheck, GitCommit, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import { UPDATE_COUNTDOWN_SECONDS } from "@/lib/system/constants";

// 侧边栏底部的「检查更新」入口
// 点击后由服务端去比对 origin/main，把结果和提交列表展示出来
// 真正的重建交给更新服务，这里只负责发起和展示

type CheckCommit = {
  sha: string;
  subject: string;
  author: string;
  date: string;
};

type CheckResult = {
  phase: string;
  message?: string;
  current: string | null;
  latest: string | null;
  behind: number;
  ahead: number;
  commits: CheckCommit[];
  checkedAt: number | null;
  error: string | null;
};

type Props = {
  collapsed: boolean;
  version: string;
  commit: string;
};

export function UpdateChecker({ collapsed, version, commit }: Props) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/mboard/api/system/check", { method: "POST" });
      const data = (await response.json()) as CheckResult & { error?: string };

      if (!response.ok) {
        setError(data.error || "检查更新失败");
        return;
      }
      // 更新服务把 git 的失败原因放在 error 里，要原样给用户看
      if (data.phase === "failed") {
        setError(data.error || "检查更新失败");
        return;
      }
      setResult(data);
    } catch {
      setError("网络异常，无法连接到服务器");
    } finally {
      setChecking(false);
    }
  };

  const openDialog = () => {
    setOpen(true);
    void check();
  };

  const startUpdate = async () => {
    setStarting(true);
    try {
      const response = await fetch("/mboard/api/system/update", { method: "POST" });
      const data = (await response.json()) as { error?: string; deadline?: number };

      if (!response.ok) {
        setError(data.error || "发起更新失败");
        return;
      }

      setOpen(false);
      // 本页立刻进入倒计时，其他页面靠 WebSocket 广播和轮询跟上
      if (typeof data.deadline === "number") {
        window.dispatchEvent(new CustomEvent("mb:update-started", { detail: { deadline: data.deadline } }));
      }
      toast.success(`已通知所有在线用户，${UPDATE_COUNTDOWN_SECONDS} 秒后开始更新`);
    } catch {
      setError("网络异常，无法连接到服务器");
    } finally {
      setStarting(false);
    }
  };

  const hasUpdate = (result?.behind ?? 0) > 0 || result?.phase === "update_available";

  return (
    <>
      {collapsed ? (
        <Tip label="检查更新">
          <button
            type="button"
            onClick={openDialog}
            className="icon-btn mb-1 h-9 w-9"
            aria-label="检查更新"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </Tip>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          className="mb-1 flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[12px] text-muted transition hover:bg-surface-2 hover:text-ink"
        >
          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">检查更新</span>
          <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">
            v{version}
          </span>
        </button>
      )}

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (starting) return;
          setOpen(next);
        }}
        size="md"
        title="检查更新"
        description="对比服务器上的 main 分支，有新提交就可以一键更新全站"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={starting}>
              关闭
            </Button>
            {hasUpdate ? (
              <Button variant="primary" loading={starting} onClick={() => void startUpdate()}>
                立即更新到 {result?.latest}
              </Button>
            ) : (
              <Button variant="secondary" loading={checking} onClick={() => void check()}>
                <RefreshCw className="h-4 w-4" />
                重新检查
              </Button>
            )}
          </>
        }
      >
        <div className="min-h-[132px]">
          {checking ? (
            <div className="flex h-[132px] flex-col items-center justify-center gap-3 text-muted">
              <Loader2 className="h-5 w-5 animate-spin text-brand" />
              <p className="text-[12.5px]">正在比对 main 分支…</p>
            </div>
          ) : error ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <div className="min-w-0 text-[12.5px] leading-5 text-ink">
                {error}
                <p className="mt-1 text-[11.5px] text-faint">
                  更新服务由 docker compose 里的 mboard-updater 提供，可以看一下它的日志
                </p>
              </div>
            </div>
          ) : result ? (
            hasUpdate ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-[11.5px]">
                  <span className="text-faint">{result.current || "当前版本"}</span>
                  <span className="text-faint">→</span>
                  <span className="font-semibold text-brand">{result.latest}</span>
                </div>

                <p className="text-[12.5px] text-muted">
                  发现 <span className="font-semibold text-ink">{result.behind}</span> 个新提交
                </p>

                <ul className="scroll-thin max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {result.commits.map((item) => (
                    <li
                      key={item.sha}
                      className="flex items-start gap-2 rounded-lg border border-line bg-surface px-2.5 py-2"
                    >
                      <GitCommit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] text-ink">{item.subject}</p>
                        <p className="mt-0.5 font-mono text-[10.5px] text-faint">
                          {item.sha}
                          {item.author ? ` · ${item.author}` : ""}
                          {item.date ? ` · ${item.date}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 px-3 py-2 text-[11.5px] leading-5 text-muted">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  更新会让所有在线用户被送回主界面，服务器随后重建并重启，构建失败会自动回滚
                </div>
              </div>
            ) : (
              <div className="flex h-[132px] flex-col items-center justify-center gap-2.5 text-center">
                <CircleCheck className="h-6 w-6 text-success" />
                <p className="text-[13px] font-medium text-ink">已经是最新版本</p>
                <p className="font-mono text-[11.5px] text-faint">
                  {result.current || commit} · v{version}
                </p>
              </div>
            )
          ) : null}
        </div>
      </Modal>
    </>
  );
}
