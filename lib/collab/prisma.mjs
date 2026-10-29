import { PrismaClient } from "@prisma/client";

// 协作服务独立使用一份 Prisma 客户端
const globalForCollab = globalThis;

export const prisma =
  globalForCollab.__mbCollabPrisma ??
  new PrismaClient({
    log: ["error"],
  });

globalForCollab.__mbCollabPrisma = prisma;
