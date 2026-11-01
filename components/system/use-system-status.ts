"use client";

import { useCallback, useEffect, useState } from "react";
import type { UpdateSnapshot } from "@/lib/system/spool";
import { STATUS_POLL_ACTIVE_MS, STATUS_POLL_IDLE_MS } from "@/lib/system/constants";

// 页面侧的更新状态中心
// 真相永远以 GET /api/system/status 为准，WebSocket 只负责把「马上要更新」秒级推过来
// 所以反向代理没转发 Upgrade、或者断网，功能都不会失效，只是慢一点

const BASE_PATH = "/mboard";
const PING_INTERVAL_MS = 25_000;

export type SystemStatus = {
  snapshot: UpdateSnapshot | null;
  // 服务端是否可达，重建期间会短暂变 false
  reachable: boolean;
  // 系统通知通道是否连通
  online: boolean;
  // 强制更新的截止时间戳
  deadline: number | null;
  // 距离截止时间还剩几秒
  secondsLeft: number | null;
};

type PollState = {
  snapshot: UpdateSnapshot | null;
  reachable: boolean;
  // 每次轮询都自增，保证失败时也能继续按节奏重试
  tick: number;
};

async function fetchStatus(): Promise<UpdateSnapshot | null> {
  try {
    // 显式带 basePath，避免首帧 hydration 之前拿到错误地址
    const response = await fetch(`${BASE_PATH}/api/system/status`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as UpdateSnapshot;
  } catch {
    return null;
  }
}

export function useSystemStatus(): SystemStatus {
  const [poll, setPoll] = useState<PollState>({ snapshot: null, reachable: true, tick: 0 });
  const [online, setOnline] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // 自适应轮询：空闲时慢，倒计时或重建中快
  // 依赖整个 poll 状态，所以任何一次结果变化都会让下一次间隔重新计算
  // 第一次必须立刻发，否则页面要等满一个间隔才知道自己在什么状态
  useEffect(() => {
    let cancelled = false;
    const phase = poll.snapshot?.update.phase;
    const busy = poll.snapshot?.update.active || phase === "countdown";
    const interval = poll.tick === 0 ? 0 : busy ? STATUS_POLL_ACTIVE_MS : STATUS_POLL_IDLE_MS;

    const timer = setTimeout(async () => {
      const next = await fetchStatus();
      if (cancelled) return;
      setPoll((prev) => ({
        snapshot: next ?? prev.snapshot,
        reachable: next !== null,
        tick: prev.tick + 1,
      }));
    }, interval);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [poll]);

  // 登录之前不连通道，否则登录页会一直触发 401 重连
  const authenticated = poll.snapshot !== null;

  // 系统通知通道，断线自动重连
  useEffect(() => {
    if (!authenticated) return;
    let socket: WebSocket | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const cleanupSocket = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close();
        } catch {
          // 忽略
        }
        socket = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer) return;
      const delay = Math.min(1000 * 2 ** retry, 20_000);
      retry += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      cleanupSocket();

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      try {
        socket = new WebSocket(`${protocol}://${window.location.host}${BASE_PATH}/system`);
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        retry = 0;
        setOnline(true);
        pingTimer = setInterval(() => {
          try {
            socket?.send(JSON.stringify({ type: "ping" }));
          } catch {
            // 忽略
          }
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        let message: { type?: string; deadline?: number } | null = null;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        // 收到倒计时立刻弹窗，不必等下一次轮询
        if (message?.type === "countdown" && typeof message.deadline === "number") {
          setDeadline(message.deadline);
        }
      };

      socket.onclose = () => {
        setOnline(false);
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        scheduleReconnect();
      };

      socket.onerror = () => {
        // onclose 会接着触发，这里不重复处理
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      cleanupSocket();
    };
  }, [authenticated]);

  // 发起更新的页面用浏览器事件通知本地其他组件
  // 这样即使系统通知通道被代理挡住，点击的人也能立刻看到倒计时
  useEffect(() => {
    const onStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ deadline?: number }>).detail;
      if (detail && typeof detail.deadline === "number") setDeadline(detail.deadline);
    };
    window.addEventListener("mb:update-started", onStarted);
    return () => window.removeEventListener("mb:update-started", onStarted);
  }, []);

  // 轮询里发现倒计时，也要把本地截止时间补上
  useEffect(() => {
    if (poll.snapshot?.update.phase === "countdown" && poll.snapshot.update.deadline) {
      setDeadline(poll.snapshot.update.deadline);
    }
  }, [poll.snapshot]);

  // 倒计时按截止时间计算，多个页面之间天然对齐
  useEffect(() => {
    if (deadline === null) {
      setSecondsLeft(null);
      return;
    }

    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [deadline]);

  return {
    snapshot: poll.snapshot,
    reachable: poll.reachable,
    online,
    deadline,
    secondsLeft,
  };
}
