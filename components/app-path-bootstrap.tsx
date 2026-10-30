"use client";

import { useEffect } from "react";

// 旧代码中的 API 地址使用根路径。统一在浏览器端补上 Next basePath，
// 这样无需让每个业务组件分别处理子路径部署。
export function AppPathBootstrap() {
  useEffect(() => {
    const basePath = "/mboard";
    const originalFetch = window.fetch.bind(window);
    const shouldPrefix = (value: string) =>
      value.startsWith("/") && !value.startsWith(basePath + "/") &&
      (value.startsWith("/api/") || value === "/api" || value.startsWith("/vditor/"));

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === "string" && shouldPrefix(input)) {
        return originalFetch(basePath + input, init);
      }
      if (input instanceof Request && shouldPrefix(new URL(input.url).pathname)) {
        const url = new URL(input.url);
        url.pathname = basePath + url.pathname;
        return originalFetch(new Request(url, input), init);
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
