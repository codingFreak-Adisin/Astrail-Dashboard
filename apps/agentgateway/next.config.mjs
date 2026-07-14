/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ["@sparticuz/chromium", "playwright-core"],
    outputFileTracingIncludes: {
      "/api/mcp/[serverId]": ["./node_modules/@sparticuz/chromium/bin/**/*"],
      "/api/website-to-mcp": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    },
    outputFileTracingExcludes: {
      "**/*": [
        "./.git/**",
        "./.next/cache/**",
      ],
    },
  },
};

export default nextConfig;
