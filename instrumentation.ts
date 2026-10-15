/**
 * Runs once when a Next.js server instance starts. Refuses to start with a broken
 * environment instead of failing later on a user's request. See lib/env.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { envProblems } = await import("@/lib/env");
  const problems = envProblems();
  if (problems.length > 0) {
    throw new Error(
      `Server environment is incomplete. Set these in .env.local (local) or the host's env vars:\n  - ${problems.join("\n  - ")}`,
    );
  }
}
