"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentChatState, resetChatSession, sendChatMessage, sendConfirmAction } from "./chat-api";
import type { ChatMessage, ChatStatus, ExtractionResult } from "./types";

const SAVED_MESSAGE = "Saved. It's in your transactions now.";

interface ChatSessionContextValue {
  messages: ChatMessage[];
  status: ChatStatus;
  isLoading: boolean;
  isPendingAction: boolean;
  welcomeTimestamp: string | null;
  scrollTop: number;
  loadInitialState: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  confirmAction: (action: "CONFIRM" | "CANCEL" | "EDIT") => Promise<void>;
  resetConversation: () => Promise<void>;
  setScrollTop: (position: number) => void;
}

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

function formatTime(): string {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  return `${(hours % 12 || 12).toString().padStart(2, "0")}:${minutes} ${ampm}`;
}

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("COLLECTING");
  const [, setCurrentDraft] = useState<ExtractionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPendingAction, setIsPendingAction] = useState(false);
  const [welcomeTimestamp, setWelcomeTimestamp] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const hasLoadedServerStateRef = useRef(false);
  const initialStateRequestRef = useRef<Promise<void> | null>(null);
  const isRequestInFlightRef = useRef(false);
  const stateRevisionRef = useRef(0);

  const router = useRouter();

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((previous) => [...previous, message]);
  }, []);

  /** Lock every open confirmation card so stale buttons can't act on a newer draft. */
  const resolvePendingCards = useCallback((resolution: NonNullable<ChatMessage["resolution"]>) => {
    setMessages((previous) =>
      previous.map((m) => (m.confirmation && !m.resolution ? { ...m, resolution } : m)),
    );
  }, []);

  const loadInitialState = useCallback(async () => {
    setWelcomeTimestamp((current) => current ?? formatTime());
    if (hasLoadedServerStateRef.current) return;
    if (initialStateRequestRef.current) return initialStateRequestRef.current;

    const stateRevision = stateRevisionRef.current;
    const request = fetchCurrentChatState().then((response) => {
      if (!response.ok || !response.data || stateRevision !== stateRevisionRef.current) return;

      setStatus(response.data.status || "COLLECTING");
      setCurrentDraft(response.data.draft);
      hasLoadedServerStateRef.current = true;
    }).finally(() => {
      initialStateRequestRef.current = null;
    });

    initialStateRequestRef.current = request;
    return request;
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const query = text.trim();
    if (!query || isRequestInFlightRef.current) return;

    isRequestInFlightRef.current = true;
    stateRevisionRef.current += 1;
    appendMessage({ id: `user-${Date.now()}`, role: "user", content: query, timestamp: formatTime() });
    setIsLoading(true);

    try {
      const response = await sendChatMessage(query);
      if (!response.ok || !response.data) {
        appendMessage({ id: `assistant-err-${Date.now()}`, role: "assistant", content: response.error || "Failed to process message.", timestamp: formatTime(), isError: true, errorMessage: query });
        return;
      }

      const data = response.data;
      if (!data.ok) {
        appendMessage({ id: `assistant-err-${Date.now()}`, role: "assistant", content: data.error, timestamp: formatTime(), isError: true, errorMessage: query });
        return;
      }

      setStatus(data.status);
      if (data.draft) setCurrentDraft(data.draft);

      if (data.status === "CONFIRMED") resolvePendingCards("confirmed");
      else if (data.status === "CANCELLED") resolvePendingCards("cancelled");
      else if (data.status !== "READY_FOR_CONFIRMATION" || data.confirmation) resolvePendingCards("replaced");

      if (data.status === "CONFIRMED" && data.transaction) {
        appendMessage({ id: `assistant-confirmed-${Date.now()}`, role: "assistant", content: SAVED_MESSAGE, timestamp: formatTime(), status: "CONFIRMED", confirmedTransaction: data.transaction });
        router.refresh();
      } else if (data.status === "CANCELLED") {
        appendMessage({ id: `assistant-cancelled-${Date.now()}`, role: "assistant", content: data.message || "Transaction discarded. Start a new message to record another.", timestamp: formatTime(), status: "CANCELLED" });
      } else if (data.status === "READY_FOR_CONFIRMATION" && data.confirmation) {
        const confirmMsg = data.question || "All required transaction details have been provided. Please review the summary below and confirm:";
        appendMessage({ id: `assistant-ready-${Date.now()}`, role: "assistant", content: confirmMsg, timestamp: formatTime(), status: "READY_FOR_CONFIRMATION", confirmation: data.confirmation });
      } else if (data.status === "READY_FOR_CONFIRMATION" && data.question) {
        // READY_FOR_CONFIRMATION with question but no confirmation card (e.g. INR rate clarification)
        appendMessage({ id: `assistant-ask-${Date.now()}`, role: "assistant", content: data.question, timestamp: formatTime(), status: "READY_FOR_CONFIRMATION", draft: data.draft });
      } else if (data.status === "AWAITING_EXCHANGE_RATE") {
        appendMessage({ id: `assistant-rate-${Date.now()}`, role: "assistant", content: data.question || "What USD → INR rate should I use? Send just the number, e.g. 88.50.", timestamp: formatTime(), status: "AWAITING_EXCHANGE_RATE", isRatePrompt: true });
      } else {
        appendMessage({ id: `assistant-ask-${Date.now()}`, role: "assistant", content: data.validation?.question || data.question || "Please provide the missing transaction details.", timestamp: formatTime(), status: "COLLECTING", draft: data.draft, validation: data.validation });
      }
    } finally {
      setIsLoading(false);
      isRequestInFlightRef.current = false;
    }
  }, [appendMessage, resolvePendingCards, router]);

  const confirmAction = useCallback(async (action: "CONFIRM" | "CANCEL" | "EDIT") => {
    if (isRequestInFlightRef.current) return;

    isRequestInFlightRef.current = true;
    stateRevisionRef.current += 1;
    setIsPendingAction(true);
    const actionText = action === "CONFIRM" ? "Confirm transaction" : action === "CANCEL" ? "Cancel transaction" : "Edit details";
    appendMessage({ id: `user-action-${Date.now()}`, role: "user", content: actionText, timestamp: formatTime() });

    try {
      const response = await sendConfirmAction(action);
      if (!response.ok || !response.data) {
        appendMessage({ id: `assistant-action-err-${Date.now()}`, role: "assistant", content: response.error || `Failed to process ${action} action.`, timestamp: formatTime(), isError: true });
        return;
      }

      const data = response.data;
      if (!data.ok) {
        appendMessage({ id: `assistant-action-err-${Date.now()}`, role: "assistant", content: data.error, timestamp: formatTime(), isError: true });
        return;
      }

      setStatus(data.status);
      resolvePendingCards(action === "CONFIRM" ? "confirmed" : action === "CANCEL" ? "cancelled" : "replaced");
      if (action === "CONFIRM" && data.transaction) {
        appendMessage({ id: `assistant-confirmed-${Date.now()}`, role: "assistant", content: SAVED_MESSAGE, timestamp: formatTime(), status: "CONFIRMED", confirmedTransaction: data.transaction });
        router.refresh();
      } else if (action === "CANCEL") {
        setCurrentDraft(null);
        appendMessage({ id: `assistant-cancelled-${Date.now()}`, role: "assistant", content: data.message || "Transaction discarded. Start a new message to record another.", timestamp: formatTime(), status: "CANCELLED" });
      } else if (action === "EDIT") {
        if (data.draft) setCurrentDraft(data.draft);
        appendMessage({ id: `assistant-edit-${Date.now()}`, role: "assistant", content: data.message || "Ready for your correction. Send your updated transaction details.", timestamp: formatTime(), status: "COLLECTING", draft: data.draft });
      }
    } finally {
      setIsPendingAction(false);
      isRequestInFlightRef.current = false;
    }
  }, [appendMessage, resolvePendingCards, router]);

  const resetConversation = useCallback(async () => {
    if (isRequestInFlightRef.current) return;

    isRequestInFlightRef.current = true;
    stateRevisionRef.current += 1;
    setIsLoading(true);
    try {
      const response = await resetChatSession();
      if (!response.ok) return;

      setMessages([]);
      setStatus("COLLECTING");
      setCurrentDraft(null);
      setWelcomeTimestamp(formatTime());
      setScrollTop(0);
      hasLoadedServerStateRef.current = true;
    } finally {
      setIsLoading(false);
      isRequestInFlightRef.current = false;
    }
  }, []);

  return <ChatSessionContext.Provider value={{ messages, status, isLoading, isPendingAction, welcomeTimestamp, scrollTop, loadInitialState, sendMessage, confirmAction, resetConversation, setScrollTop }}>{children}</ChatSessionContext.Provider>;
}

export function useChatSession(): ChatSessionContextValue {
  const context = useContext(ChatSessionContext);
  if (!context) throw new Error("useChatSession must be used inside ChatSessionProvider.");
  return context;
}
