import { cn, initials } from "@/lib/utils";

type AvatarProps = {
  name: string;
  color?: string;
  size?: number;
  className?: string;
  ring?: boolean;
};

// 文字头像：取名称前两个字，底色由账号配置里的 color 决定
export function Avatar({ name, color = "#6353f5", size = 32, className, ring }: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none",
        ring && "ring-2 ring-surface",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        backgroundColor: `${color}22`,
        color,
        border: `1px solid ${color}33`,
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
