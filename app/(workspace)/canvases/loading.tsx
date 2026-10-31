// 路由级加载骨架：首屏渲染期间保持页面结构稳定
export default function CanvasesLoading() {
  return (
    <div className="scroll-thin flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="h-7 w-28 animate-pulse rounded-lg bg-surface-2" />
            <div className="mt-2 h-4 w-64 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="h-9 w-28 animate-pulse rounded-xl bg-surface-2" />
        </div>

        <div className="mt-5 h-10 w-full animate-pulse rounded-xl bg-surface-2 sm:w-72" />

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
            >
              <div className="aspect-[16/10] animate-pulse bg-surface-2" />
              <div className="space-y-2 p-3.5">
                <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
                <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
