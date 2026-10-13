"use client";

import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, Download, Menu, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavbarProps {
  onToggleSidebar?: () => void;
  onOpenFinanceAI: () => void;
  isFinanceAIOpen?: boolean;
  onExport?: () => void;
}

export function Navbar({ onToggleSidebar, onOpenFinanceAI, isFinanceAIOpen = false, onExport }: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-border bg-card px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Link href="/dashboard" className="min-w-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Image src="/brand/websitevikreta-logo-horizontal.svg" alt="Website Vikreta" width={1364} height={300} priority className="h-auto w-40 sm:w-48" />
        </Link>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-2 rounded-full border border-success bg-success/10 px-3 py-1 text-caption text-success md:inline-flex">
          <CheckCircle2 className="size-3.5" aria-hidden />
          Bank synced
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onExport} className="h-10 rounded-full px-3 sm:px-4">
          <Download className="size-4" aria-hidden />
          <span className="hidden sm:inline">Export</span>
        </Button>
        <button
          type="button"
          onClick={onOpenFinanceAI}
          aria-expanded={isFinanceAIOpen}
          aria-label={isFinanceAIOpen ? "Close Finance Chat Bot" : "Open Finance Chat Bot"}
          className={cn(
            "flex h-10 items-center gap-2 rounded-full px-3 text-caption transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4",
            isFinanceAIOpen
              ? "bg-accent text-foreground ring-1 ring-border"
              : "bg-foreground text-background hover:bg-accent hover:text-foreground"
          )}
        >
          <Sparkles className="size-4 text-primary" aria-hidden />
          <span className="hidden sm:inline">Finance Chat Bot</span>
        </button>
      </div>
    </header>
  );
}
