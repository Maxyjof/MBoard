import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import bcrypt from "bcryptjs";
import { z } from "zod";

// 账号配置：只从配置文件读取，不入库
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

// 用账号密码校验身份，成功返回展示信息
export async function verifyCredentials(
  username: string,
  password: string
): Promise<{ username: string; displayName: string; color: string } | null> {
  const accounts = loadAccounts();
  const account = accounts.find((item) => item.username === username);

  if (!account) {
    // 做一次无效比较，避免通过响应时间枚举账号
    await bcrypt.compare(password, "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    return null;
  }

  const matched = account.passwordHash
    ? await bcrypt.compare(password, account.passwordHash)
    : password === account.password;

  if (!matched) return null;

  return {
    username: account.username,
    displayName: account.displayName,
    color: account.color,
  };
}
