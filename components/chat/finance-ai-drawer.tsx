"use client";

import { useEffect } from "react";
import { RotateCcw, X } from "lucide-react";
import { BotFace } from "./bot-face";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
    scrollTop,
    loadInitialState,
    sendMessage,
    confirmAction,
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
          className="fixed inset-0 z-40 bg-foreground/40 xl:hidden"
        />
      ) : null}

      <aside
        aria-label="Finance Chat Bot Assistant"
        className={cn(
          "flex flex-col border-border bg-card transition-[transform,opacity] duration-200 ease-in-out",
          "fixed top-16 bottom-0 right-0 z-50 w-full sm:w-[400px] shadow-2xl",
          "xl:static xl:z-auto xl:h-full xl:min-h-0 xl:shrink-0 xl:shadow-none",
          isOpen
            ? "translate-x-0 border-l opacity-100 xl:w-[var(--chat-panel-width,380px)]"
            : "pointer-events-none translate-x-full overflow-hidden border-l-0 opacity-0 xl:w-0 xl:translate-x-0"
        )}
        style={isOpen ? { '--chat-panel-width': `${panelWidth}px` } as React.CSSProperties : undefined}
      >
        <div
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
        >
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-muted/60 px-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="grid size-9 place-items-center rounded-full border border-border bg-surface-elevated text-foreground shadow-xs shrink-0">
                <BotFace className="size-5" />
              </div>
              <h2 className="truncate text-title-sm font-semibold text-foreground">Finance Chat Bot</h2>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button type="button" variant="ghost" size="icon" onClick={resetConversation} title="Reset conversation draft" aria-label="Reset conversation" disabled={isLoading || isPendingAction} className="text-muted-foreground">
                <RotateCcw aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close Finance Chat Bot" className="text-muted-foreground">
                <X aria-hidden />
              </Button>
            </div>
          </header>

          <ChatMessageList
            messages={messages}
            isLoading={isLoading}
            isPendingAction={isPendingAction}
            initialScrollTop={scrollTop}
            onScrollPositionChange={setScrollTop}
            onConfirm={() => confirmAction("CONFIRM")}
            onEdit={() => confirmAction("EDIT")}
            onCancel={() => confirmAction("CANCEL")}
            onRetry={sendMessage}
            onQuickAction={sendMessage}
          />

          <ChatInput status={status} isLoading={isLoading || isPendingAction} onSend={sendMessage} />
        </div>
      </aside>
    </>
  );
}
