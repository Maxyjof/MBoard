// 画布引擎预热：进入画板库后空闲时提前下载 Excalidraw 分包，缩短首次打开等待
let started = false;

export function preloadExcalidraw() {
  if (started || typeof window === "undefined") return;
  started = true;
  void import("@excalidraw/excalidraw").catch(() => {
    started = false;
  });
}

export function schedulePreloadExcalidraw() {
  if (typeof window === "undefined") return;

  const run = () => preloadExcalidraw();
  const idle = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;

  if (idle) {
    idle(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 1200);
  }
}
