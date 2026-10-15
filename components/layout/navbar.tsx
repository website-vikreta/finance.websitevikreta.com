"use client";

import Image from "next/image";
import Link from "next/link";
import { Download, Menu } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

interface NavbarProps {
  onToggleSidebar?: () => void;
}

export function Navbar({ onToggleSidebar }: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-border bg-card px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Button type="button" variant="ghost" size="icon-lg" onClick={onToggleSidebar} className="text-muted-foreground lg:hidden" aria-label="Open navigation">
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
      </div>
    </header>
  );
}
