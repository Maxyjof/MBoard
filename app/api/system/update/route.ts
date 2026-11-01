import { getSession } from "@/lib/auth/session";
import { fail, ok, serverError, unauthorized } from "@/lib/http";
import { publishSystem } from "@/lib/system/broadcast";
import { UPDATE_COUNTDOWN_MS, UPDATE_COUNTDOWN_SECONDS, UPDATE_TRIGGER_COOLDOWN_MS } from "@/lib/system/constants";
import { buildSnapshot, isBusyPhase, writeRequest } from "@/lib/system/spool";

// 触发强制更新：写一个 update 请求（带倒计时截止时间）给更新服务
// 更新服务等到截止时间才真正开始拉代码与重建，这 15 秒就是给所有人的缓冲
// 同时通过系统通知通道把所有在线用户拉到倒计时弹窗

export const dynamic = "force-dynamic";

// 同一进程内的触发冷却，挡住连点
let lastTriggerAt = 0;

export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const snapshot = buildSnapshot();

    if (!snapshot.updater.available) {
      return fail("没有检测到更新服务，请确认 mboard-updater 容器已经启动", 503);
    }

    if (!snapshot.updater.alive) {
      return fail("更新服务当前没有心跳，重启 mboard-updater 容器后再试", 503);
    }

    if (isBusyPhase(snapshot.update.phase)) {
      return fail("已经有一次更新在进行中，请等待它结束", 409);
    }

    if (Date.now() - lastTriggerAt < UPDATE_TRIGGER_COOLDOWN_MS) {
      return fail("刚刚已经触发过更新，请稍等几秒", 429);
    }
    lastTriggerAt = Date.now();

    const deadline = Date.now() + UPDATE_COUNTDOWN_MS;
    const request = writeRequest("update", session.username, deadline);

    // 推送倒计时，让所有在线页面立刻弹出提示
    publishSystem({
      type: "countdown",
      requestId: request.id,
      deadline,
      actor: session.username,
      latest: snapshot.update.latest,
      current: snapshot.update.current,
      behind: snapshot.update.behind,
      countdownSeconds: UPDATE_COUNTDOWN_SECONDS,
    });

    return ok({
      requestId: request.id,
      deadline,
      countdownSeconds: UPDATE_COUNTDOWN_SECONDS,
    });
  } catch (error) {
    return serverError(error);
  }
}
