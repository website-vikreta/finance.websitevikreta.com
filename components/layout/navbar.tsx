"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NavbarProps {
  onToggleSidebar?: () => void;
}

export function Navbar({ onToggleSidebar }: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b print:hidden border-border bg-card px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Button type="button" variant="ghost" size="icon-lg" onClick={onToggleSidebar} className="text-muted-foreground lg:hidden" aria-label="Open navigation">
          <Menu className="size-5" aria-hidden />
        </Button>
        <Link href="/dashboard" className="min-w-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Image src="/brand/websitevikreta-logo-horizontal.svg" alt="Website Vikreta" width={1364} height={300} priority className="h-auto w-40 sm:w-48" />
        </Link>
      </div>

    </header>
  );
}
