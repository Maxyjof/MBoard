import { getSession } from "@/lib/auth/session";
import { fail, ok, serverError, unauthorized } from "@/lib/http";
import { buildSnapshot, isBusyPhase, waitForRequest, writeRequest } from "@/lib/system/spool";

// 检查更新：写一个 check 请求给更新服务，然后同步等它的结果
// 服务器上只是 git fetch，正常一两秒就回来，超过 25 秒当作更新服务不可用

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CHECK_TIMEOUT_MS = 25_000;

export async function POST() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const snapshot = buildSnapshot();

    if (!snapshot.updater.available) {
      return fail(
        "没有检测到更新服务，请确认 docker-compose.yml 里的 mboard-updater 容器已经启动",
        503
      );
    }

    if (isBusyPhase(snapshot.update.phase)) {
      return fail("正在更新中，请等当前更新结束再检查", 409);
    }

    const request = writeRequest("check", session.username);
    const result = await waitForRequest(request.id, CHECK_TIMEOUT_MS);

    if (!result) {
      return fail(
        "更新服务没有响应，请检查 mboard-updater 容器日志与 data/update 目录挂载",
        504
      );
    }

    return ok({
      phase: result.phase,
      message: result.message,
      current: result.current,
      latest: result.latest,
      behind: result.behind,
      ahead: result.ahead,
      commits: result.commits,
      checkedAt: result.checkedAt,
      error: result.error,
    });
  } catch (error) {
    return serverError(error);
  }
}
