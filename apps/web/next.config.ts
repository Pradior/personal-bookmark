import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // monorepo 内的 TS 包需要 Next 转译
  transpilePackages: ['@pb/contract', '@pb/core', '@pb/db'],
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // pg / drizzle 只在服务端跑，别打包进 client bundle
    serverSourceMaps: true,
  },
  serverExternalPackages: ['pg', 'drizzle-orm'],
};

export default nextConfig;
