import { PrismaClient } from "@prisma/client";
import { transactionContext } from "./history/engine.mjs";

// Prisma 客户端单例，避免开发环境热更新时重复建立连接
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const database =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = database;
}

/**
 * 事务透传代理。
 * withHistory 打开事务后会用 AsyncLocalStorage 记录事务客户端，
 * 此时路由代码里直接调用 prisma.xxx 会命中同一个事务，保证业务写入与历史记录原子提交。
 * 事务内再次调用 $transaction 时复用外层事务，避免 SQLite 嵌套事务报错。
 */
export const prisma = new Proxy(database, {
  get(target, property) {
    const tx = transactionContext.getStore();
    if (!tx) {
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }

    if (property === "$transaction") {
      return (work: unknown) => {
        if (typeof work === "function") return (work as (client: unknown) => unknown)(tx);
        return Promise.all(work as Promise<unknown>[]);
      };
    }

    const value = Reflect.get(tx, property);
    return typeof value === "function" ? value.bind(tx) : value;
  },
});
