import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
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

/**
 * Session epoch: embedded in every session JWT and required back at verification
 * (lib/auth.ts), so sessions die whenever the application is re-run.
 * - Dev (next dev): evaluated per boot — every `npm run dev` restart forces re-login.
 * - Production (next build): one UUID per build, persisted to .next/wv-session-epoch,
 *   read back by the running server so node and the edge proxy/middleware share it —
 *   every deploy retires all existing cookies, must-sign-in-again after release.
 * The env var overrides everything (reproducible builds). When neither the var nor
 * the marker exists (direct node/tsx scripts), the check is simply off.
 */
function sessionEpoch(phase: string): string {
  if (process.env.WV_SESSION_EPOCH) return process.env.WV_SESSION_EPOCH;
  if (phase === PHASE_DEVELOPMENT_SERVER) return crypto.randomUUID();
  const marker = path.resolve(".next", "wv-session-epoch");
  if (phase === PHASE_PRODUCTION_BUILD) {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    const epoch = crypto.randomUUID();
    fs.writeFileSync(marker, epoch);
    return epoch;
  }
  try {
    return fs.readFileSync(marker, "utf8").trim();
  } catch {
    return "";
  }
}

const nextConfig = (phase: string): NextConfig => ({
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    agentUpgrade: "security",
  },
  env: {
    // "" (never) disables the epoch check in lib/auth.ts, e.g. pure node scripts.
    WV_SESSION_EPOCH: sessionEpoch(phase),
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
});

export default nextConfig;
