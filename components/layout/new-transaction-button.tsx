"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpenFinanceAI } from "@/components/layout/app-shell";

/** Transactions are entered through Finance AI, so "new" opens the chat panel. */
export function NewTransactionButton({ label = "New transaction" }: { label?: string }) {
  const openFinanceAI = useOpenFinanceAI();
  return (
    <Button onClick={openFinanceAI} className="gap-2">
      <Plus aria-hidden />
      {label}
    </Button>
  );
}
