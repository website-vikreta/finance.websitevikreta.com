/**
 * Required server environment, checked once at startup (instrumentation.ts) so a missing
 * variable fails loudly on boot instead of on the first request that needs it.
 * Values are never logged, only the names of what's wrong.
 */

const REQUIRED: Record<string, (value: string) => string | null> = {
  DATABASE_URL: (v) => (/^postgres(ql)?:\/\//.test(v) ? null : "must be a postgres:// connection string"),
  JWT_SECRET: (v) => (v.length >= 32 ? null : "must be at least 32 characters"),
  ADMIN_EMAIL: (v) => (v.includes("@") ? null : "must be an email address"),
  ADMIN_PASSWORD_HASH: (v) => (/^[0-9a-f]{64}$/i.test(v) ? null : "must be a 64-character SHA-256 hex digest"),
  GEMINI_API_KEY: () => null,
};

/** Returns one message per missing or malformed variable; empty when everything is fine. */
export function envProblems(env: Record<string, string | undefined> = process.env): string[] {
  return Object.entries(REQUIRED).flatMap(([name, check]) => {
    const value = env[name]?.trim();
    if (!value) return [`${name} is not set`];
    const problem = check(value);
    return problem ? [`${name} ${problem}`] : [];
  });
}
