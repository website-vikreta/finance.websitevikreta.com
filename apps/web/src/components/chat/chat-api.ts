import type {
  PostMessageResponse,
  GetMessageResponse,
  ConfirmActionResponse,
  ResetResponse,
} from "./types";

/**
 * Robust JSON fetch wrapper with HTTP status handling
 */
async function fetchJson<T>(
  url: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (!isJson) {
      if (res.status === 401) {
        return {
          ok: false,
          status: 401,
          error: "Session expired or unauthenticated. Please sign in again.",
        };
      }
      return {
        ok: false,
        status: res.status,
        error: `Unexpected server response (HTTP ${res.status}).`,
      };
    }

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        return {
          ok: false,
          status: 401,
          error: (data as { error?: string })?.error || "Session expired. Sign in again.",
        };
      }
      if (res.status === 429) {
        return {
          ok: false,
          status: 429,
          error: "Rate limit reached. Please wait a moment before trying again.",
        };
      }
      return {
        ok: false,
        status: res.status,
        data,
        error: (data as { error?: string })?.error || `Request failed with HTTP ${res.status}`,
      };
    }

    return { ok: true, status: res.status, data };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Request timed out."
        : "Network error. Please check your connection.";
    return { ok: false, status: 0, error: message };
  }
}

/**
 * Inspects current server draft and session state
 */
export async function fetchCurrentChatState(): Promise<{
  ok: boolean;
  data?: GetMessageResponse;
  error?: string;
}> {
  const result = await fetchJson<GetMessageResponse>("/api/chatbot/message", {
    method: "GET",
    cache: "no-store",
  });

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error || "Failed to inspect chatbot draft." };
  }

  return { ok: true, data: result.data };
}

/**
 * Sends a manager message to the chatbot pipeline
 */
export async function sendChatMessage(
  message: string
): Promise<{
  ok: boolean;
  data?: PostMessageResponse;
  error?: string;
}> {
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: "Message cannot be empty." };
  }

  const result = await fetchJson<PostMessageResponse>("/api/chatbot/message", {
    method: "POST",
    body: JSON.stringify({ message: trimmed }),
  });

  if (!result.ok) {
    return {
      ok: false,
      data: result.data,
      error: result.error || "Failed to process chat message.",
    };
  }

  return { ok: true, data: result.data };
}

/**
 * Performs an explicit manager confirmation action: CONFIRM, CANCEL, or EDIT
 */
export async function sendConfirmAction(
  action: "CONFIRM" | "CANCEL" | "EDIT"
): Promise<{
  ok: boolean;
  data?: ConfirmActionResponse;
  error?: string;
}> {
  const result = await fetchJson<ConfirmActionResponse>("/api/chatbot/confirm", {
    method: "POST",
    body: JSON.stringify({ action }),
  });

  if (!result.ok) {
    return {
      ok: false,
      data: result.data,
      error: result.error || `Failed to execute ${action} action.`,
    };
  }

  return { ok: true, data: result.data };
}

/**
 * Resets the draft and session for the current user
 */
export async function resetChatSession(): Promise<{
  ok: boolean;
  data?: ResetResponse;
  error?: string;
}> {
  const result = await fetchJson<ResetResponse>("/api/chatbot/reset", {
    method: "POST",
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "Failed to reset session." };
  }

  return { ok: true, data: result.data };
}
