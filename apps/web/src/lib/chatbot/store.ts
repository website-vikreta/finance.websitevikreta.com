/**
 * Chatbot Phase 3 + Phase 4/5 — In-memory draft and session store.
 *
 * Single responsibility: hold one transaction draft AND one conversation
 * session state per authenticated user for the duration of the current
 * server process.
 *
 * Design decisions:
 *   - Keyed by userId (from the JWT session) → different users never share state.
 *   - In-memory Map → no database, no persistence, appropriate for Phase 3–5 testing.
 *   - Next.js runs as a single Node.js process in dev; state survives across
 *     requests within the same process lifetime (resets on server restart).
 *   - Phase 6 may replace this with a DB-backed session without changing the API.
 *
 * Phase 4/5 additions:
 *   - ChatStatus type and ChatSessionState interface define the conversation state machine.
 *   - A separate sessionStore Map holds one ChatSessionState per userId.
 *   - getSession / setSession / clearSession are new exports — do NOT mix with draft exports.
 *   - clearAll is the canonical reset: clears both draft and session atomically.
 *
 * This module MUST NOT:
 *   - call Gemini
 *   - validate fields
 *   - merge extractions
 *   - access the database
 *   - perform currency conversion
 */

import type { ExtractionResult } from "./extract";
import type { CurrencyConversionResult } from "@/lib/currency/exchange-rate";
import { EMPTY_DRAFT } from "./merge";

// ─── Draft store (Phase 3 — unchanged) ───────────────────────────────────────

// Module-level Map — one entry per userId.
const store = new Map<string, ExtractionResult>();

/**
 * Returns the current draft for a user.
 * Returns a fresh empty draft if no draft exists yet.
 */
export function getDraft(userId: string): ExtractionResult {
  return store.get(userId) ?? { ...EMPTY_DRAFT };
}

/**
 * Saves (overwrites) the draft for a user.
 */
export function setDraft(userId: string, draft: ExtractionResult): void {
  store.set(userId, draft);
}

/**
 * Clears the draft for a user.
 * Subsequent getDraft calls will return a fresh empty draft.
 */
export function clearDraft(userId: string): void {
  store.delete(userId);
}

// ─── Session store (Phase 4/5 — new) ─────────────────────────────────────────

/**
 * The conversation state machine status values.
 *
 *   COLLECTING            — still gathering transaction fields (Phase 1–3 loop).
 *   AWAITING_EXCHANGE_RATE — draft is complete, currency is USD; waiting for manager rate.
 *   READY_FOR_CONFIRMATION — Phase 4 is done; confirmation is pending manager action.
 *   CONFIRMED             — manager confirmed the transaction (Phase 6 will save it).
 *   CANCELLED             — manager cancelled; draft and session have been cleared.
 */
export type ChatStatus =
  | 'COLLECTING'
  | 'AWAITING_EXCHANGE_RATE'
  | 'READY_FOR_CONFIRMATION'
  | 'CONFIRMED'
  | 'CANCELLED';

import type { ConfirmationTransaction } from "./confirm";

/** Holds conversation status and optional currency result for one user session. */
export interface ChatSessionState {
  status: ChatStatus;
  /** Set when Phase 4 has completed. undefined while COLLECTING or AWAITING_EXCHANGE_RATE. */
  currency?: CurrencyConversionResult;
  /** Stable idempotency key for confirmation request and retries. */
  idempotencyKey?: string;
  /** The saved confirmation transaction, stored upon explicit confirmation. */
  confirmedTransaction?: ConfirmationTransaction;
}

/** Default session state for any user with no active session. */
const DEFAULT_SESSION: ChatSessionState = { status: 'COLLECTING' };

// Module-level Map — one session entry per userId.
const sessionStore = new Map<string, ChatSessionState>();

/**
 * Returns the current session state for a user.
 * Returns { status: 'COLLECTING' } if no session has been started yet.
 */
export function getSession(userId: string): ChatSessionState {
  return sessionStore.get(userId) ?? { ...DEFAULT_SESSION };
}

/**
 * Saves (overwrites) the session state for a user.
 */
export function setSession(userId: string, state: ChatSessionState): void {
  sessionStore.set(userId, state);
}

/**
 * Clears the session for a user, resetting to { status: 'COLLECTING' }.
 */
export function clearSession(userId: string): void {
  sessionStore.delete(userId);
}

// ─── Combined reset ───────────────────────────────────────────────────────────

/**
 * Atomically clears both draft and session for a user.
 *
 * This is the canonical reset operation. Both the /reset endpoint and the
 * CANCEL action call clearAll to guarantee no ghost state is left behind.
 */
export function clearAll(userId: string): void {
  clearDraft(userId);
  clearSession(userId);
}
