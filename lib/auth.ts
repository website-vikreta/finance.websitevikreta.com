import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/** Cookie name used for the session token. */
export const SESSION_COOKIE = "wv_finance_session";

/** Session duration: 8 working hours. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

/** Role is not in the token: app_users.role is read per request so changes apply immediately. */
export interface SessionPayload extends JWTPayload {
  userId: string;
  /** WV_SESSION_EPOCH this token was created under (see next.config.ts). */
  epoch?: string;
}

/**
 * The session epoch of this run (dev boot or production build). Tokens carry it
 * and verification requires a match, so re-running the application retires every
 * old cookie and forces a fresh login. Empty (scripts without the env) = check off.
 */
export const SESSION_EPOCH = process.env.WV_SESSION_EPOCH || undefined;

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET env var is not set.");
  return new TextEncoder().encode(secret);
}

/**
 * Signs a new session JWT.
 * Called after successful credential check in the login server action.
 */
export async function createSession(userId: string): Promise<string> {
  const claims: { userId: string; epoch?: string } = { userId };
  if (SESSION_EPOCH) claims.epoch = SESSION_EPOCH;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Verifies a session JWT, including its epoch.
 * Returns the payload on success, null if expired, tampered, or from an older run.
 */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (SESSION_EPOCH && payload.epoch !== SESSION_EPOCH) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
