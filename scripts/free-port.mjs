/**
 * Frees the dev port before `next dev` boots.
 *
 * On Windows, killing npm (or its terminal) does not always take down the whole
 * node process tree, so a previous `next dev` can keep listening after "nothing
 * is running" — the next boot then dies with EADDRINUSE.
 *
 * Safe by design: it kills ONLY processes whose command line points at THIS
 * repo's node_modules. Anything else on the port is left alone with a clear
 * message. On non-Windows it just skips (job control there is reliable).
 */
import { execFileSync } from "node:child_process";

const PORT = process.env.DEV_PORT ?? "3030";
// The marker every process of this project carries in its command line.
const MARKER = /finance\.websitevikreta\.com/i;
const isWindows = process.platform === "win32";

function powershell(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

export function main() {
  if (!isWindows) return;

  let owners;
  try {
    owners = powershell(
      `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
    );
  } catch {
    owners = "";
  }
  if (!owners) {
    console.log(`Port ${PORT} is free.`);
    return;
  }

  const pids = owners.split(/\s+/).filter(Boolean).map(Number);
  for (const pid of pids) {
    let commandLine = "";
    try {
      commandLine = powershell(
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      );
    } catch {
      /* process already gone */
      continue;
    }

    // The stale server of this repo (node_modules of this project) — safe to kill.
    if (MARKER.test(commandLine) && /node_modules/i.test(commandLine)) {
      console.log(`Stopping stale dev server from a previous run (PID ${pid}).`);
      try {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      } catch {
        /* already dead */
      }
      continue;
    }
    console.error(
      `Port ${PORT} is held by PID ${pid} which does not belong to this repo:\n  ${commandLine}\n` +
        `Resolve it manually (taskkill /PID ${pid} /F) — the guard never kills foreign processes.`,
    );
  }
}

main();
