"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Loader2, RefreshCw, Terminal, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useSystemStatus } from "@/components/system/use-system-status";
import { UPDATE_COUNTDOWN_SECONDS } from "@/lib/system/constants";
import { cn } from "@/lib/utils";

// 全局更新闸门
// 挂在根布局里，任何页面（含全屏画布、登录页）都会收到强制更新通知
// 它只做三件事：倒计时弹窗、更新中的全屏遮罩、失败后的回滚提示

const RELOAD_FLAG = "mb-update-reloaded-commit";
const COMMIT_KEY = "mb-app-commit";

export function UpdateGate() {
  const { snapshot, reachable, secondsLeft } = useSystemStatus();
  const router = useRouter();

  const [acknowledged, setAcknowledged] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failedDismissed, setFailedDismissed] = useState(false);
  const applyingSince = useRef<number | null>(null);

  const phase = snapshot?.update.phase ?? "idle";
  const message = snapshot?.update.message || "";
  const logTail = snapshot?.update.logTail || "";
  const current = snapshot?.update.current || snapshot?.app.shortCommit || "";
  const latest = snapshot?.update.latest || "";
  const counting = (secondsLeft ?? 0) > 0;
  // 倒计时归零后到更新服务真正接手之间，也按「更新中」处理
  const preparing = phase === "countdown" && (secondsLeft ?? 1) <= 0;
  const applying = phase === "applying";
  const overlay = applying || preparing;

  // 新一轮倒计时重新开始时要允许再次弹窗
  useEffect(() => {
    setAcknowledged(false);
  }, [snapshot?.update.deadline]);

  useEffect(() => {
    if (phase !== "failed") setFailedDismissed(false);
  }, [phase]);

  // 更新中的计时器
  useEffect(() => {
    if (!overlay) {
      applyingSince.current = null;
      setElapsed(0);
      return;
    }
    if (applyingSince.current === null) applyingSince.current = Date.now();
    const timer = setInterval(() => {
      if (applyingSince.current === null) return;
      setElapsed(Math.floor((Date.now() - applyingSince.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [overlay]);

  // 新版上线后自动刷新一次，用 sessionStorage 挡住重复刷新
  useEffect(() => {
    if (phase !== "done" || !snapshot) return;
    const commit = snapshot.app.commit;
    try {
      if (sessionStorage.getItem(RELOAD_FLAG) === commit) return;
      sessionStorage.setItem(RELOAD_FLAG, commit);
    } catch {
      // 隐私模式下拿不到 storage 就直接刷新
    }
    window.location.reload();
  }, [phase, snapshot]);

  // 版本变了给个提示，顺便记住这次看到的版本
  useEffect(() => {
    const commit = snapshot?.app.commit;
    if (!commit || commit === "unknown") return;

    let previous: string | null = null;
    try {
      previous = localStorage.getItem(COMMIT_KEY);
    } catch {
      return;
    }

    if (previous && previous !== commit) {
      toast.success(`MBoard 已更新到 ${snapshot?.app.shortCommit}`, { duration: 6000 });
    }

    try {
      localStorage.setItem(COMMIT_KEY, commit);
    } catch {
      // 忽略
    }
  }, [snapshot?.app.commit, snapshot?.app.shortCommit]);

  const retry = async () => {
    try {
      const response = await fetch("/mboard/api/system/update", { method: "POST" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        toast.error(data.error || "重试失败，请稍后再试");
        return;
      }
      setFailedDismissed(true);
      toast.success("已重新发起更新");
    } catch {
      toast.error("网络异常，请稍后再试");
    }
  };

  // 倒计时不依赖状态快照，只要有截止时间就先弹出来
  return (
    <>
      {/* 倒计时弹窗：不可关闭，确定后回到主界面 */}
      <Modal
        open={counting && !acknowledged}
        onOpenChange={() => undefined}
        hideClose
        size="sm"
        centered
        className="border-brand/30"
      >
        <div className="flex flex-col items-center pt-1 text-center">
          <div className="relative">
            <CountdownRing total={UPDATE_COUNTDOWN_SECONDS} left={secondsLeft ?? 0} />
            <span className="absolute inset-0 flex items-center justify-center text-[26px] font-semibold tabular-nums text-ink">
              {secondsLeft ?? 0}
            </span>
          </div>

          <h2 className="mt-4 text-[15px] font-semibold text-ink">网站即将强制更新</h2>
          <p className="mt-1.5 text-[12.5px] leading-5 text-muted">
            所有人会在倒计时结束后被送回主界面，随后服务器重建并重启，期间可能短暂无法访问
          </p>

          <div className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-[11.5px] text-muted">
            <span className="text-faint">{current || "当前版本"}</span>
            <span className="text-faint">→</span>
            <span className="font-semibold text-brand">{latest || "新版本"}</span>
          </div>

          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300 ease-linear"
              style={{
                width: `${Math.min(100, Math.max(0, ((secondsLeft ?? 0) / UPDATE_COUNTDOWN_SECONDS) * 100))}%`,
              }}
            />
          </div>

          <Button
            variant="primary"
            className="mt-5 w-full"
            onClick={() => {
              setAcknowledged(true);
              router.push("/boards");
            }}
          >
            确定并回到主界面
          </Button>
          <p className="mt-2 text-[11px] text-faint">倒计时不会因为关闭提示而暂停</p>
        </div>
      </Modal>

      {/* 确定之后的角落小提示 */}
      {counting && acknowledged ? (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[125] flex items-center gap-2.5 rounded-xl border border-line bg-elevated px-3.5 py-2.5 shadow-float">
          <Loader2 className="h-4 w-4 animate-spin text-brand" />
          <span className="text-[12.5px] text-ink">
            {secondsLeft} 秒后强制更新
          </span>
        </div>
      ) : null}

      {/* 更新中的全屏遮罩 */}
      {overlay ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-bg/95 px-6 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md text-center">
            <div className="relative mx-auto flex h-14 w-14 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-brand/20" />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
                <Loader2 className="h-6 w-6 animate-spin text-brand" />
              </span>
            </div>

            <h2 className="mt-5 text-[16px] font-semibold text-ink">正在更新网站</h2>
            <p className="mt-1.5 text-[12.5px] leading-5 text-muted">
              {message || "服务器正在拉取代码并重新构建镜像，通常需要一到三分钟"}
            </p>

            <div className="mt-5 h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full w-1/3 animate-shimmer rounded-full bg-brand" />
            </div>

            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-faint">
              <span className="tabular-nums">{elapsed}s</span>
              <span>·</span>
              <span className={cn(reachable ? "text-faint" : "text-warning")}>
                {reachable ? "服务在线" : "服务重启中，稍后自动恢复"}
              </span>
            </div>

            {logTail ? (
              <div className="mt-4 text-left">
                <button
                  type="button"
                  onClick={() => setLogOpen((value) => !value)}
                  className="mx-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-faint transition hover:text-ink"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  {logOpen ? "收起构建日志" : "查看构建日志"}
                </button>
                {logOpen ? (
                  <pre className="scroll-thin mt-2 max-h-52 overflow-auto rounded-xl border border-line bg-surface p-3 font-mono text-[11px] leading-5 text-muted">
                    {logTail}
                  </pre>
                ) : null}
              </div>
            ) : null}

            <p className="mt-6 text-[11px] text-faint">
              更新完成后页面会自动刷新，不需要手动操作
            </p>
          </div>
        </div>
      ) : null}

      {/* 更新失败 / 已回滚 */}
      <Modal
        open={phase === "failed" && !failedDismissed && !overlay}
        onOpenChange={(open) => setFailedDismissed(!open)}
        size="md"
        title={
          <span className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-danger" />
            更新失败
          </span>
        }
        description={
          snapshot?.update.rolledBack
            ? "已自动回滚到更新前的版本，网站恢复可用"
            : "回滚也没有成功，需要人工介入检查服务器"
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setFailedDismissed(true)}>
              知道了
            </Button>
            <Button variant="primary" loading={false} onClick={() => void retry()}>
              <RefreshCw className="h-4 w-4" />
              重试更新
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-danger/25 bg-danger/5 px-3 py-2.5 text-[12.5px] leading-5 text-ink">
            {snapshot?.update.error || "构建过程出现了未知错误"}
          </div>

          {snapshot?.update.rolledBack ? (
            <div className="flex items-center gap-2 text-[12px] text-success">
              <CircleCheck className="h-4 w-4" />
              已回滚并重启，当前版本 {current || snapshot?.app.shortCommit}
            </div>
          ) : null}

          {logTail ? (
            <pre className="scroll-thin max-h-56 overflow-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-[11px] leading-5 text-muted">
              {logTail}
            </pre>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

// 倒计时进度环
function CountdownRing({ total, left }: { total: number; left: number }) {
  const size = 96;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(1, Math.max(0, left / Math.max(1, total)));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-line"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
        className="stroke-brand transition-[stroke-dashoffset] duration-300 ease-linear"
      />
    </svg>
  );
}
