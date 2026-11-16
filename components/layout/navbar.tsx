"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// The sign-out dialog (and its dialog library) is only fetched when the user asks for it.
const SignOutDialog = dynamic(
  () => import("./sign-out-dialog").then((m) => m.SignOutDialog),
  { ssr: false },
);

interface NavbarProps {
  onToggleSidebar?: () => void;
}

export function Navbar({ onToggleSidebar }: NavbarProps) {
  const [role, setRole] = useState<string | null>(null);
  const [showSignOut, setShowSignOut] = useState(false);
  const [signOutMounted, setSignOutMounted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const loadRole = () => {
      fetch("/api/auth/me", { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.role) setRole(data.role);
        })
        .catch(() => {});
    };
    // The role badge is not needed for first paint: wait for idle so this DB-backed
    // request stays off the hydration path.
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(loadRole, { timeout: 2000 });
      return () => {
        window.cancelIdleCallback(id);
        controller.abort();
      };
    }
    const id = window.setTimeout(loadRole, 1200);
    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b print:hidden border-border bg-card px-4 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="ghost" size="icon-lg" onClick={onToggleSidebar} className="text-muted-foreground lg:hidden" aria-label="Open navigation">
            <Menu className="size-5" aria-hidden />
          </Button>
          <Link href="/dashboard" className="min-w-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Image src="/brand/websitevikreta-logo-horizontal.svg" alt="Website Vikreta" width={1364} height={300} loading="eager" fetchPriority="high" className="h-auto w-40 sm:w-48" />
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {role ? (
            <Badge variant="default" className="h-7 px-3 text-xs font-semibold">
              {role}
            </Badge>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setSignOutMounted(true);
              setShowSignOut(true);
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      {/* Sign-out confirmation dialog — fetched and mounted on first use */}
      {signOutMounted && (
        <SignOutDialog open={showSignOut} onOpenChange={setShowSignOut} />
      )}
    </>
  );
}
