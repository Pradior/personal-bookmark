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
  // pg / drizzle / sharp 都是原生或动态 require 的依赖，不能被打包
  // （sharp 打包后会在 page data 收集阶段报 "Could not load the sharp module"）
  serverExternalPackages: ['pg', 'drizzle-orm', 'sharp'],
};

export default nextConfig;
