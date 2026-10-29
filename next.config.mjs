/** @type {import('next').NextConfig} */
const nextConfig = {
  // 画布内含大量交互与 WebSocket 连接，关闭严格模式避免开发环境重复挂载
  reactStrictMode: false,
  poweredByHeader: false,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: ["@prisma/client", "prisma", "bcryptjs", "yjs", "y-protocols", "lib0"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
