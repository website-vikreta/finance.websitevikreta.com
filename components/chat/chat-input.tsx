"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatStatus } from "./types";

interface ChatInputProps {
  status: ChatStatus;
  isLoading: boolean;
  onSend: (message: string) => void;
}

export function ChatInput({ status, isLoading, onSend }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isLoading) {
      textareaRef.current?.focus();
    }
  }, [isLoading]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const placeholderText =
    status === "AWAITING_EXCHANGE_RATE"
      ? "Enter USD → INR rate (e.g. 88.50)..."
      : status === "READY_FOR_CONFIRMATION"
        ? "Type 'confirm', 'cancel', or send your correction..."
        : "Record an income or expense (e.g. Acme paid $500 today)...";

  return (
    <form onSubmit={handleSubmit} className="shrink-0 border-t border-border bg-card p-3">
      <label htmlFor="finance-ai-input" className="sr-only">
        Message Finance Chat Bot
      </label>
      <div className="rounded-xl border border-input bg-background/50 p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40 transition-colors">
        <textarea
          ref={textareaRef}
          id="finance-ai-input"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder={placeholderText}
          className="w-full resize-none bg-transparent px-2 py-1 text-body-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        />

        <div className="flex items-center justify-between border-t border-border/50 pt-2 px-1">
          <span className="text-[11px] font-mono text-muted-foreground">
            {isLoading ? "Processing..." : "Press Enter ↵ to send"}
          </span>

          <Button
            type="submit"
            size="icon"
            disabled={!value.trim() || isLoading}
            aria-label="Send message"
            className="size-8 rounded-lg"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
