import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/** Cookie name used for the session token. */
export const SESSION_COOKIE = "wv_finance_session";

/** Session duration: 8 working hours. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export interface SessionPayload extends JWTPayload {
  userId: string;
  role: "admin";
}

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
  return new SignJWT({ userId, role: "admin" } as Omit<SessionPayload, keyof JWTPayload>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Verifies a session JWT.
 * Returns the payload on success, null if expired or tampered.
 */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
