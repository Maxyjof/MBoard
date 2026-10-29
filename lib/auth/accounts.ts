import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import bcrypt from "bcryptjs";
import { z } from "zod";

// 账号白名单：只从配置文件读取，账号本身不入库
const AccountSchema = z
  .object({
    username: z.string().min(1).max(64),
    displayName: z.string().min(1).max(64).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    password: z.string().min(1).optional(),
    passwordHash: z.string().min(10).optional(),
  })
  .refine((item) => Boolean(item.password || item.passwordHash), {
    message: "账号必须提供 password 或 passwordHash",
  });

const AccountsFileSchema = z.object({
  users: z.array(AccountSchema).min(1),
});

export type Account = z.infer<typeof AccountSchema> & {
  displayName: string;
  color: string;
};

type Cache = {
  mtimeMs: number;
  accounts: Account[];
};

// 用文件 mtime 做缓存，改完配置文件重启（或等下一次读取）即可生效
let cache: Cache | null = null;

function accountsPath(): string {
  const configured = process.env.ACCOUNTS_FILE || "./config/accounts.yml";
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function loadAccounts(): Account[] {
  const filePath = accountsPath();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`找不到账号配置文件: ${filePath}`);
  }

  if (cache && cache.mtimeMs === stat.mtimeMs) {
    return cache.accounts;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = AccountsFileSchema.safeParse(YAML.parse(raw));

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "配置"}: ${issue.message}`)
      .join("; ");
    throw new Error(`账号配置格式错误: ${detail}`);
  }

  const usernames = new Set<string>();
  const accounts: Account[] = parsed.data.users.map((item) => {
    if (usernames.has(item.username)) {
      throw new Error(`账号重复: ${item.username}`);
    }
    usernames.add(item.username);
    return {
      ...item,
      displayName: item.displayName || item.username,
      color: item.color || "#6353f5",
    };
  });

  cache = { mtimeMs: stat.mtimeMs, accounts };
  return accounts;
}

// 按用户名取配置账号
export function getAccount(username: string): Account | null {
  return loadAccounts().find((item) => item.username === username) ?? null;
}

// 校验配置文件里的初始密码
export async function verifyAccountPassword(account: Account, password: string): Promise<boolean> {
  return account.passwordHash
    ? bcrypt.compare(password, account.passwordHash)
    : password === account.password;
}

// 未知账号也做一次无效比较，避免通过响应时间枚举用户名
export const DUMMY_PASSWORD_HASH = "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
