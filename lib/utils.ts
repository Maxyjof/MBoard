import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// 合并 className，后面的类覆盖前面的冲突类
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 生成头像/协作者初始字：英文取首字母，中文取前两个字符
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const chars = Array.from(trimmed);
  if (/^[A-Za-z]/.test(trimmed)) {
    return chars[0].toUpperCase();
  }
  return chars.slice(0, 2).join("").toUpperCase();
}

// 相对时间：刚刚 / 3 分钟前 / 昨天 12:30 / 10-21
export function relativeTime(input: string | number | Date): string {
  const date = new Date(input);
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) {
    return `昨天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

// 日期格式化：用于截止时间展示
export function formatDate(input: string | number | Date | null | undefined): string {
  if (!input) return "";
  const date = new Date(input);
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

// 是否已过期
export function isOverdue(input: string | number | Date | null | undefined): boolean {
  if (!input) return false;
  return new Date(input).getTime() < Date.now();
}

// 简单随机 id（客户端临时态用）
export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
