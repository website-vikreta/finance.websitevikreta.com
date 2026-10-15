import type { ExtractionResult } from "@/lib/chatbot/extract";
import type { ChatStatus } from "@/lib/chatbot/store";
import type { ConfirmationTransaction } from "@/lib/chatbot/confirm";

export type { ExtractionResult, ChatStatus, ConfirmationTransaction };

export interface ValidationState {
  complete: boolean;
  missingField: string | null;
  question: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: ChatStatus;
  draft?: ExtractionResult;
  validation?: ValidationState;
  confirmation?: {
    required: boolean;
    transaction: ConfirmationTransaction;
    /** Likely-duplicate warning shown on the card; confirming still saves. */
    duplicate?: string;
  };
  confirmedTransaction?: ConfirmationTransaction;
  /** Set once a confirmation card is settled; its buttons must not act on the server's newer draft. */
  resolution?: "confirmed" | "cancelled" | "replaced";
  isRatePrompt?: boolean;
  isError?: boolean;
  errorMessage?: string;
}

export interface PostMessageSuccessResponse {
  ok: true;
  status: ChatStatus;
  extraction?: ExtractionResult;
  draft: ExtractionResult;
  validation?: ValidationState;
  question?: string;
  confirmation?: {
    required: boolean;
    transaction: ConfirmationTransaction;
    /** Likely-duplicate warning shown on the card; confirming still saves. */
    duplicate?: string;
  };
  currency?: {
    exchange_rate: number | null;
    inr_amount: number;
  };
  transaction?: ConfirmationTransaction;
  message?: string;
}

export interface PostMessageErrorResponse {
  ok: false;
  error: string;
}

export type PostMessageResponse = PostMessageSuccessResponse | PostMessageErrorResponse;

export interface GetMessageResponse {
  ok: boolean;
  status: ChatStatus;
  draft: ExtractionResult;
  validation: ValidationState;
  currency: {
    original_amount: number;
    original_currency: "INR" | "USD";
    exchange_rate: number | null;
    inr_amount: number;
    exchange_rate_date: string;
  } | null;
  error?: string;
}

export interface ConfirmActionSuccessResponse {
  ok: true;
  status: "CONFIRMED" | "CANCELLED" | "COLLECTING";
  transaction?: ConfirmationTransaction;
  message?: string;
  draft?: ExtractionResult;
}

export interface ConfirmActionErrorResponse {
  ok: false;
  error: string;
}

export type ConfirmActionResponse = ConfirmActionSuccessResponse | ConfirmActionErrorResponse;

export interface ResetResponse {
  ok: boolean;
  message?: string;
  error?: string;
}
