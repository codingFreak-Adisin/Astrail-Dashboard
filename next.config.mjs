/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      {
        source: "/asteail",
        destination: "/mcp/astrail-dev",
        permanent: true,
      },
      {
        source: "/astail",
        destination: "/mcp/astrail-dev",
        permanent: true,
      },
      {
        source: "/astail.dev",
        destination: "/mcp/astrail-dev",
        permanent: true,
      },
      {
        source: "/astrial",
        destination: "/mcp/astrail-dev",
        permanent: true,
      },
    ];
  },
  experimental: {
    cpus: 1,
    workerThreads: false,
    webpackBuildWorker: false,
    serverComponentsExternalPackages: ["@sparticuz/chromium", "playwright-core"],
    outputFileTracingIncludes: {
      "/api/mcp/[serverId]": ["./node_modules/@sparticuz/chromium/bin/**/*"],
      "/api/website-to-mcp": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    },
    outputFileTracingExcludes: {
      "**/*": [
        "./.git/**",
        "./.next/cache/**",
        "./apps/agentgateway/**",
      ],
    },
  },
};

export default nextConfig;
