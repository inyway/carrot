/** @type {import('next').NextConfig} */
const nextConfig = {
  // api 폴더 (NestJS 백엔드)를 Next.js 빌드에서 제외
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
    dirs: ['app', 'components', 'lib', 'hooks', 'utils'],
  },
  webpack: (config) => {
    // api 폴더를 webpack에서 제외
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        '**/node_modules/**',
        '**/api/**',
        '**/.git/**',
      ],
    };
    return config;
  },
};

export default nextConfig;
