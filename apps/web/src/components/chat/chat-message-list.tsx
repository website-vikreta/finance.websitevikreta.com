"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransactionSummaryCard } from "./transaction-summary-card";
import type { ChatMessage } from "./types";

interface ChatMessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isPendingAction: boolean;
  welcomeTimestamp: string | null;
  initialScrollTop: number;
  onScrollPositionChange: (position: number) => void;
  onConfirm: (messageId?: string) => void;
  onEdit: (messageId?: string) => void;
  onCancel: (messageId?: string) => void;
  onCancelledAction?: () => void;
  onRetry?: (messageText: string) => void;
  onQuickAction: (actionText: string) => void;
}

export function ChatMessageList({
  messages,
  isLoading,
  isPendingAction,
  welcomeTimestamp,
  initialScrollTop,
  onScrollPositionChange,
  onConfirm,
  onEdit,
  onCancel,
  onCancelledAction,
  onRetry,
  onQuickAction,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [welcomeTime, setWelcomeTime] = useState("07:20 pm");
  const hasRestoredScrollPosition = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (welcomeTimestamp) setWelcomeTime(welcomeTimestamp);
    }, 0);
    return () => clearTimeout(timer);
  }, [welcomeTimestamp]);

  useLayoutEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    if (!hasRestoredScrollPosition.current) {
      scrollContainer.scrollTop = initialScrollTop;
      hasRestoredScrollPosition.current = true;
      return;
    }

    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading, initialScrollTop]);

  useEffect(() => () => {
    if (scrollRef.current) onScrollPositionChange(scrollRef.current.scrollTop);
  }, [onScrollPositionChange]);

  const lastMessage = messages[messages.length - 1];
  const isPostConfirmationOrCancel =
    lastMessage &&
    !isPendingAction &&
    !isLoading &&
    (lastMessage.status === "CONFIRMED" ||
      lastMessage.status === "CANCELLED" ||
      lastMessage.content.includes("What would you like to record today"));

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable]">
      {/* ── Fixed Welcome Card & Initial Quick Action Pills ── */}
      <div className="flex flex-col items-start">
        <div className="flex items-start gap-2.5 max-w-full w-full">
          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-elevated border border-border text-primary shadow-xs">
            <Sparkles className="size-3.5" aria-hidden />
          </div>

          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="rounded-2xl border border-border bg-card p-4 text-foreground shadow-sm">
              <h3 className="text-title-sm font-bold text-foreground">
                Welcome to Finance Chat Bot! 👋
              </h3>
              <p className="mt-1.5 text-body-sm text-muted-foreground leading-relaxed">
                I’m your virtual finance assistant. I’m here to help you manage your income and expenses, record transaction details, handle multiple currencies, and guide you through the transaction confirmation process. Let’s get started!
              </p>
              <div className="mt-2.5 flex justify-end">
                <span className="text-[11px] font-mono text-muted-foreground/70">
                  {welcomeTime || "06:07 PM"}
                </span>
              </div>
            </div>

            {/* Render initial quick action pills when conversation is fresh */}
            {messages.length === 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  disabled={isLoading || isPendingAction}
                  onClick={() => onQuickAction("I want to add an expense")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-caption font-semibold text-foreground hover:bg-accent hover:border-primary/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 shadow-xs active:scale-95 cursor-pointer"
                >
                  Add Expense
                </button>
                <button
                  type="button"
                  disabled={isLoading || isPendingAction}
                  onClick={() => onQuickAction("I want to add an income")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-caption font-semibold text-foreground hover:bg-accent hover:border-primary/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 shadow-xs active:scale-95 cursor-pointer"
                >
                  Add Income
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Active Conversation Stream ── */}
      {messages.map((message, index) => {
        const isUser = message.role === "user";
        const isLast = index === messages.length - 1;

        if (isUser) {
          return (
            <div key={message.id} className="flex flex-col items-end">
              <div className="max-w-[85%] rounded-2xl bg-foreground px-4 py-2.5 text-body-sm font-medium text-background shadow-sm">
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
              <span className="mt-1 text-[11px] font-mono text-muted-foreground/70 px-1">
                {message.timestamp}
              </span>
            </div>
          );
        }

        // Assistant Message
        return (
          <div key={message.id} className="flex flex-col items-start">
            <div className="flex items-start gap-2.5 max-w-full">
              <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-elevated border border-border text-primary">
                <Sparkles className="size-3.5" aria-hidden />
              </div>

              <div className="min-w-0 flex-1">
                {message.isError ? (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-body-sm text-destructive space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden />
                      <p className="break-words">{message.content}</p>
                    </div>
                    {onRetry && isLast && (
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        onClick={() => onRetry(message.errorMessage || "")}
                        className="gap-1 mt-1 font-semibold"
                      >
                        <RotateCcw className="size-3" aria-hidden />
                        Retry Request
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-card px-4 py-2.5 text-body-sm text-foreground shadow-sm">
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>

                    {/* Pending Confirmation Transaction Card */}
                    {message.confirmation?.transaction && (
                      <TransactionSummaryCard
                        transaction={message.confirmation.transaction}
                        isCancelled={Boolean(message.isCancelled || message.confirmation.isCancelled)}
                        isPendingAction={isPendingAction}
                        onConfirm={() => {
                          if (message.isCancelled || message.confirmation?.isCancelled) {
                            onCancelledAction?.();
                          } else {
                            onConfirm(message.id);
                          }
                        }}
                        onEdit={() => {
                          if (message.isCancelled || message.confirmation?.isCancelled) {
                            onCancelledAction?.();
                          } else {
                            onEdit(message.id);
                          }
                        }}
                        onCancel={() => onCancel(message.id)}
                      />
                    )}

                    {/* Confirmed Transaction Card */}
                    {message.confirmedTransaction && (
                      <TransactionSummaryCard
                        transaction={message.confirmedTransaction}
                        isConfirmed={true}
                      />
                    )}

                    {/* Discarded Transaction State */}
                    {message.status === "CANCELLED" && (
                      <div className="mt-2 text-caption text-muted-foreground italic">
                        Session state cleared.
                      </div>
                    )}
                  </div>
                )}

                <span className="mt-1 inline-block text-[11px] font-mono text-muted-foreground/70 px-1">
                  {message.timestamp}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Post-Confirmation / Loop Quick Action Pills ── */}
      {isPostConfirmationOrCancel && (
        <div className="flex flex-col items-start pl-9 pt-1">
          <p className="text-[11px] font-mono text-muted-foreground mb-1.5">
            Start next transaction:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isLoading || isPendingAction}
              onClick={() => onQuickAction("I want to add an expense")}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-caption font-semibold text-foreground hover:bg-accent hover:border-primary/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 shadow-xs active:scale-95 cursor-pointer"
            >
              Add Expense
            </button>
            <button
              type="button"
              disabled={isLoading || isPendingAction}
              onClick={() => onQuickAction("I want to add an income")}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-caption font-semibold text-foreground hover:bg-accent hover:border-primary/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 shadow-xs active:scale-95 cursor-pointer"
            >
              Add Income
            </button>
          </div>
        </div>
      )}

      {/* Typing / Processing Indicator */}
      {isLoading && (
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-elevated border border-border text-primary animate-pulse">
            <Sparkles className="size-3.5" aria-hidden />
          </div>
          <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce" />
              <span className="ml-2 text-caption text-muted-foreground">
                Analyzing transaction...
              </span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
