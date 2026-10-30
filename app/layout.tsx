import type { Metadata, Viewport } from "next";
import "./globals.css";
import "vditor/dist/index.css";
import { AppToaster } from "@/components/ui/toaster";
import { AppPathBootstrap } from "@/components/app-path-bootstrap";

export const metadata: Metadata = {
  title: {
    default: "MBoard · 共享协作工作台",
    template: "%s · MBoard",
  },
  description: "看板与无限画布一体的团队工作台，支持多人实时协作",
  applicationName: "MBoard",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f14" },
  ],
  width: "device-width",
  initialScale: 1,
};

// 在首帧之前应用主题，避免深浅色闪烁
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem("mb-theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

const basePathScript = `
(function () {
  var base = "/mboard";
  var original = window.fetch.bind(window);
  function prefix(value) {
    return typeof value === "string" && value.charAt(0) === "/" && value.indexOf(base + "/") !== 0 &&
      (value.indexOf("/api/") === 0 || value === "/api" || value.indexOf("/vditor/") === 0);
  }
  window.fetch = function (input, init) {
    if (prefix(input)) return original(base + input, init);
    return original(input, init);
  };
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: basePathScript }} />
      </head>
      <body>
        <AppPathBootstrap />
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
