import { cn } from "@/lib/utils";

// 品牌图形：三块错落的圆角方块拼成的工作台
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mb-brand-gradient" x1="4" y1="2" x2="37" y2="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C6FFF" />
          <stop offset="0.55" stopColor="#6353F5" />
          <stop offset="1" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#mb-brand-gradient)" />
      <rect x="9" y="9.5" width="9.5" height="21" rx="3" fill="white" fillOpacity="0.96" />
      <rect x="21" y="9.5" width="10" height="9.5" rx="3" fill="white" fillOpacity="0.78" />
      <rect x="21" y="21.5" width="10" height="9" rx="3" fill="white" fillOpacity="0.55" />
    </svg>
  );
}

// 品牌字标
export function BrandWord({ className, markSize = 28 }: { className?: string; markSize?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark size={markSize} />
      <span className="text-[15px] font-semibold tracking-tight text-ink">MBoard</span>
    </span>
  );
}
