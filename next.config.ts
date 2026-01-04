import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
  },
});

const nextConfig: NextConfig = {
  output: "standalone",
  // Externalize pino packages to prevent bundling issues with worker threads
  serverExternalPackages: ["pino", "pino-pretty", "pino-logfmt"],
};

export default withPWA(nextConfig);
