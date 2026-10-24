import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    agentUpgrade: "security",
  },
  // Dev-only: which hosts may open the HMR WebSocket (/_next/hmr). Next 16 blocks
  // this dev resource for any other origin, and the dev client responds to the
  // blocked handshake by force-reloading the page — so any other host name here
  // turns development into an endless refresh loop. Covers the three ways this
  // app is browsed locally: hostname, loopback, and LAN IP. Ignored in production.
  allowedDevOrigins: ["localhost", "127.0.0.1", "172.22.83.102"],
  // pdf-parse reaches into optional binary dependencies; it must not be bundled.
  serverExternalPackages: ["pdf-parse"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
