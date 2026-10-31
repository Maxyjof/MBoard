import { database } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { fail } from "@/lib/http";
import {
  ALL_MODELS,
  record,
  snapshot,
  transactionContext,
} from "./engine.mjs";

type ScopedModels = string[];

/**
 * 给内容写入接口套一层操作历史。
 * @param title 展示在「操作记录」里的中文标题
 * @param handler 原有的路由处理函数
 * @param models 需要纳入本次记录的模型，默认全部；按业务裁剪可以显著降低写请求开销
 */
export function withHistory<T extends (...args: any[]) => Promise<Response>>(
  title: string,
  handler: T,
  models: ScopedModels = ALL_MODELS
): T {
  return (async (...args: Parameters<T>) => {
    const user = await getSession();
    if (!user) return fail("未登录", 401);

    try {
      return await database.$transaction(
        async (tx) =>
          transactionContext.run(tx, async () => {
            // 写前快照与写后差异都必须落在同一个事务内
            const before = await snapshot(tx, models);
            const response = await handler(...args);
            // 处理器返回失败时回滚整个事务，避免出现“接口报错但数据已改”
            if (!response.ok) throw { response };
            await record(tx, user.username, title, before, models);
            return response;
          }),
        { maxWait: 15000, timeout: 30000 }
      );
    } catch (error) {
      if (error && typeof error === "object" && "response" in error) {
        return (error as { response: Response }).response;
      }
      console.error(`[history] ${title} 失败`, error);
      return fail("操作失败，未保存改动", 500);
    }
  }) as T;
}
