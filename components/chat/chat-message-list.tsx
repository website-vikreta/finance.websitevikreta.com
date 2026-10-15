"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TransactionSummaryCard } from "./transaction-summary-card";
import type { ChatMessage } from "./types";

interface ChatMessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isPendingAction: boolean;
  welcomeTimestamp: string | null;
  initialScrollTop: number;
  onScrollPositionChange: (position: number) => void;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
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
          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-elevated border border-border text-foreground shadow-xs">
            <Sparkles className="size-3.5" aria-hidden />
          </div>

          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="rounded-xl border border-border bg-card p-4 text-foreground">
              <p className="text-body-sm text-foreground">Tell me about an income or expense.</p>
              <p className="mt-1 text-body-sm text-muted-foreground">e.g. &ldquo;Paid ₹5,000 for office rent today&rdquo;</p>
              <div className="mt-2.5 flex justify-end">
                <span className="text-micro font-mono text-muted-foreground/70">
                  {welcomeTime || "06:07 PM"}
                </span>
              </div>
            </div>

            {/* Render initial quick action pills when conversation is fresh */}
            {messages.length === 0 && (
              <QuickActions disabled={isLoading || isPendingAction} onQuickAction={onQuickAction} className="pt-0.5" />
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
              <div className="max-w-[85%] rounded-xl bg-foreground px-4 py-2.5 text-body-sm font-medium text-background">
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
              <span className="mt-1 text-micro font-mono text-muted-foreground/70 px-1">
                {message.timestamp}
              </span>
            </div>
          );
        }

        // Assistant Message
        return (
          <div key={message.id} className="flex flex-col items-start">
            <div className="flex items-start gap-2.5 max-w-full">
              <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-elevated border border-border text-foreground">
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
                  <div className="rounded-xl border border-border bg-card px-4 py-2.5 text-body-sm text-foreground">
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>

                    {/* Pending Confirmation Transaction Card */}
                    {message.confirmation?.transaction && message.resolution !== "confirmed" && (
                      <TransactionSummaryCard
                        transaction={message.confirmation.transaction}
                        isCancelled={Boolean(message.resolution)}
                        discardedLabel={message.resolution === "replaced" ? "Replaced" : "Discarded"}
                        isPendingAction={isPendingAction}
                        onConfirm={onConfirm}
                        onEdit={onEdit}
                        onCancel={onCancel}
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

                <span className="mt-1 inline-block text-micro font-mono text-muted-foreground/70 px-1">
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
          <p className="text-micro font-mono text-muted-foreground mb-1.5">
            Record another:
          </p>
          <QuickActions disabled={isLoading || isPendingAction} onQuickAction={onQuickAction} />
        </div>
      )}

      {/* Typing / Processing Indicator */}
      {isLoading && (
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-elevated border border-border text-foreground animate-pulse">
            <Sparkles className="size-3.5" aria-hidden />
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
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

const QUICK_ACTIONS = [
  { label: "Add expense", message: "I want to add an expense" },
  { label: "Add income", message: "I want to add an income" },
] as const;

function QuickActions({
  disabled,
  onQuickAction,
  className,
}: {
  disabled: boolean;
  onQuickAction: (actionText: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {QUICK_ACTIONS.map((action) => (
        <Button
          key={action.label}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onQuickAction(action.message)}
          className="rounded-full px-3"
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
