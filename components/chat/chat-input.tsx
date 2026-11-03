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
      ? "USD → INR rate, e.g. 88.50"
      : status === "READY_FOR_CONFIRMATION"
        ? "Confirm, cancel or correct"
        : "Message Finance Chat Bot";

  return (
    <form onSubmit={handleSubmit} className="shrink-0 border-t border-border bg-card p-3">
      <label htmlFor="finance-ai-input" className="sr-only">
        Message Finance Chat Bot
      </label>
      <div className="flex items-end gap-2 rounded-xl border border-input bg-background/50 p-1.5 pl-3 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
        <textarea
          ref={textareaRef}
          id="finance-ai-input"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder={placeholderText}
          className="field-sizing-content max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-body-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!value.trim() || isLoading}
          aria-label="Send message"
          className="size-8 shrink-0 rounded-lg"
        >
          {isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
        </Button>
      </div>
    </form>
  );
}
