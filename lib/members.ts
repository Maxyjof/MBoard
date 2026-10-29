import { getAccount, listAccounts } from "@/lib/auth/accounts";
import { prisma } from "@/lib/prisma";
import type { MemberDTO } from "@/lib/types";

// 成员列表 = 配置文件账号 + 用户自己改过的显示名/头像色
export async function listMembers(): Promise<MemberDTO[]> {
  const accounts = listAccounts();
  const profiles = await prisma.userProfile.findMany({
    select: { username: true, displayName: true, color: true },
  });
  const profileMap = new Map(profiles.map((item) => [item.username, item]));

  return accounts.map((account) => {
    const override = profileMap.get(account.username);
    return {
      username: account.username,
      displayName: override?.displayName || account.displayName,
      color: override?.color || account.color,
    };
  });
}

// 账号是否仍在配置白名单里
export function isKnownUsername(username: string): boolean {
  return Boolean(getAccount(username));
}
