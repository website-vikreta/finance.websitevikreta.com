"use client";

import Image from "next/image";
import Link from "next/link";
import { Download, Menu, Sparkles } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

interface NavbarProps {
  onToggleSidebar?: () => void;
  onOpenFinanceAI: () => void;
  isFinanceAIOpen?: boolean;
}

export function Navbar({ onToggleSidebar, onOpenFinanceAI, isFinanceAIOpen = false }: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-border bg-card px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Button type="button" variant="ghost" size="icon-lg" onClick={onToggleSidebar} className="text-muted-foreground md:hidden" aria-label="Open navigation">
          <Menu className="size-5" aria-hidden />
        </Button>
        <Link href="/dashboard" className="min-w-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Image src="/brand/websitevikreta-logo-horizontal.svg" alt="Website Vikreta" width={1364} height={300} priority className="h-auto w-40 sm:w-48" />
        </Link>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <a
          href="/api/reports/export?period=fy"
          aria-label="Export this financial year as CSV"
          className={buttonVariants({ variant: "outline", className: "px-3 sm:px-4" })}
        >
          <Download aria-hidden />
          <span className="hidden sm:inline">Export</span>
        </a>
        <Button
          type="button"
          variant={isFinanceAIOpen ? "secondary" : "outline"}
          onClick={onOpenFinanceAI}
          aria-expanded={isFinanceAIOpen}
          aria-label={isFinanceAIOpen ? "Close Finance Chat Bot" : "Open Finance Chat Bot"}
          className="px-3 sm:px-4"
        >
          <Sparkles aria-hidden />
          <span className="hidden sm:inline">Finance Chat Bot</span>
        </Button>
      </div>
    </header>
  );
}
