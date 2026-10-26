import os from "node:os";
import type { NextConfig } from "next";

/**
 * Every host this machine can be browsed from, computed fresh each dev boot:
 * machine hostname, loopback, and each non-internal interface address (LAN,
 * WiFi, WSL/vEthernet, ...). Survives IP changes without config edits.
 */
function localDevOrigins(): string[] {
  const origins = new Set<string>(["localhost", "127.0.0.1", "**.localhost"]);
  origins.add(os.hostname().toLowerCase());
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address && !address.internal) origins.add(address.address);
    }
  }
  return [...origins];
}

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
  // turns development into an endless refresh loop.
  //
  // IPs must be listed literally (the matcher only supports dot-segment
  // wildcards, not `10.55.*.*`). The machine's address changes with DHCP and
  // network switches, so we enumerate every non-internal interface at config
  // load instead of hardcoding one IP — That is what caused the loop before
  // (stale 172.22.83.102 vs. current 10.55.45.102). Production ignores this.
  allowedDevOrigins: localDevOrigins(),
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
