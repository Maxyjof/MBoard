import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getAccount, verifyAccountPassword, DUMMY_PASSWORD_HASH } from "./accounts";
import type { SessionUser } from "./token";

// 账号的有效资料 = 配置文件初始值 + 数据库中的个人覆盖
export async function getEffectiveProfile(username: string): Promise<SessionUser | null> {
  const account = getAccount(username);
  if (!account) return null;

  const override = await prisma.userProfile.findUnique({ where: { username } });

  return {
    username,
    displayName: override?.displayName || account.displayName,
    color: override?.color || account.color,
  };
}

// 校验当前密码：优先数据库里的新密码，没有再退回配置文件
export async function verifyCurrentPassword(username: string, password: string): Promise<boolean> {
  const account = getAccount(username);
  if (!account) return false;

  const override = await prisma.userProfile.findUnique({ where: { username } });
  if (override?.passwordHash) {
    return bcrypt.compare(password, override.passwordHash);
  }
  return verifyAccountPassword(account, password);
}

// 登录校验：账号必须在配置文件里，密码以数据库覆盖为准
export async function authenticate(
  username: string,
  password: string
): Promise<SessionUser | null> {
  const account = getAccount(username);

  if (!account) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return null;
  }

  const override = await prisma.userProfile.findUnique({ where: { username } });
  const matched = override?.passwordHash
    ? await bcrypt.compare(password, override.passwordHash)
    : await verifyAccountPassword(account, password);

  if (!matched) return null;

  return {
    username: account.username,
    displayName: override?.displayName || account.displayName,
    color: override?.color || account.color,
  };
}

// 更新显示名，保留已有密码与颜色
export async function updateProfile(
  username: string,
  displayName: string
): Promise<SessionUser | null> {
  const account = getAccount(username);
  if (!account) return null;

  const profile = await prisma.userProfile.upsert({
    where: { username },
    update: { displayName },
    create: { username, displayName, color: account.color },
  });

  return {
    username,
    displayName: profile.displayName,
    color: profile.color || account.color,
  };
}

// 修改密码：写入数据库覆盖，配置文件无需改动
export async function updatePassword(username: string, password: string): Promise<boolean> {
  const account = getAccount(username);
  if (!account) return false;

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.userProfile.upsert({
    where: { username },
    update: { passwordHash },
    create: {
      username,
      displayName: account.displayName,
      color: account.color,
      passwordHash,
    },
  });
  return true;
}
