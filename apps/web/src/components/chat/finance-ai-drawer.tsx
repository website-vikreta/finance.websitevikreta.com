"use client";

import { useEffect } from "react";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ChatInput } from "./chat-input";
import { ChatMessageList } from "./chat-message-list";
import { useChatSession } from "./chat-session-provider";

interface FinanceAIDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Desktop panel width in pixels, controlled by the parent resize handle. */
  panelWidth?: number;
}

export function FinanceAIDrawer({ isOpen, onClose, panelWidth = 380 }: FinanceAIDrawerProps) {
  const {
    messages,
    status,
    isLoading,
    isPendingAction,
    welcomeTimestamp,
    scrollTop,
    loadInitialState,
    sendMessage,
    confirmAction,
    handleCancelledAction,
    resetConversation,
    setScrollTop,
  } = useChatSession();

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) void loadInitialState();
  }, [isOpen, loadInitialState]);

  return (
    <>
      {isOpen ? (
        <button
          type="button"
          aria-label="Close Finance Chat Bot overlay"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-foreground/40 md:hidden"
        />
      ) : null}

      <aside
        aria-label="Finance Chat Bot Assistant"
        className={cn(
          "flex flex-col border-border bg-card transition-[transform,opacity] duration-200 ease-in-out",
          "fixed inset-y-16 right-0 z-50 w-full sm:w-[380px] shadow-2xl",
          "md:static md:z-auto md:h-full md:min-h-0 md:shrink-0 md:shadow-none",
          isOpen
            ? "translate-x-0 border-l opacity-100 md:w-[var(--chat-panel-width,380px)]"
            : "pointer-events-none translate-x-full overflow-hidden border-l-0 opacity-0 md:w-0 md:translate-x-0"
        )}
        style={isOpen ? { '--chat-panel-width': `${panelWidth}px` } as React.CSSProperties : undefined}
      >
        <div
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
        >
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-muted/60 px-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="grid size-9 place-items-center rounded-full border border-border bg-surface-elevated text-primary shadow-xs shrink-0">
                <Sparkles className="size-4" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-title-sm font-semibold text-foreground truncate">Finance Chat Bot</h2>
                  {status === "READY_FOR_CONFIRMATION" ? (
                    <Badge variant="outline" className="border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary shrink-0">Review Pending</Badge>
                  ) : status === "AWAITING_EXCHANGE_RATE" ? (
                    <Badge variant="outline" className="border-warning/40 bg-warning/10 px-1.5 py-0 text-[10px] font-medium text-warning shrink-0">Rate Required</Badge>
                  ) : status === "CONFIRMED" ? (
                    <Badge variant="outline" className="border-success/40 bg-success/10 px-1.5 py-0 text-[10px] font-medium text-success shrink-0">Confirmed</Badge>
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground shrink-0">v0.1</span>
                  )}
                </div>
                <p className="text-caption text-muted-foreground truncate">Record &amp; track transactions in INR / USD</p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={resetConversation} title="Reset conversation draft" aria-label="Reset conversation" disabled={isLoading || isPendingAction} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50">
                <RotateCcw className="size-4" aria-hidden />
              </button>
              <button type="button" onClick={onClose} aria-label="Close Finance Chat Bot" className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <X className="size-4.5" aria-hidden />
              </button>
            </div>
          </header>

          <ChatMessageList
            messages={messages}
            isLoading={isLoading}
            isPendingAction={isPendingAction}
            welcomeTimestamp={welcomeTimestamp}
            initialScrollTop={scrollTop}
            onScrollPositionChange={setScrollTop}
            onConfirm={(id) => confirmAction("CONFIRM", id)}
            onEdit={(id) => confirmAction("EDIT", id)}
            onCancel={(id) => confirmAction("CANCEL", id)}
            onCancelledAction={handleCancelledAction}
            onRetry={sendMessage}
            onQuickAction={sendMessage}
          />

          <ChatInput status={status} isLoading={isLoading || isPendingAction} onSend={sendMessage} />
        </div>
      </aside>
    </>
  );
}
