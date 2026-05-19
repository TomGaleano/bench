import type { NextConfig } from "next";

const apiUrl = process.env.PILAB_API_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        destination: `${apiUrl}/:path*`,
        source: "/api/:path*"
      }
    ];
  }
};

export default nextConfig;
