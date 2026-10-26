"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface NavbarProps {
  onToggleSidebar?: () => void;
}

export function Navbar({ onToggleSidebar }: NavbarProps) {
  const [role, setRole] = useState<string | null>(null);
  const [showSignOut, setShowSignOut] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.role) setRole(data.role);
      })
      .catch(() => {});
  }, []);

  const handleSignOut = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout");
      window.location.href = "/login";
    } catch {
      window.location.href = "/login";
    }
  }, [loggingOut]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b print:hidden border-border bg-card px-4 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="ghost" size="icon-lg" onClick={onToggleSidebar} className="text-muted-foreground lg:hidden" aria-label="Open navigation">
            <Menu className="size-5" aria-hidden />
          </Button>
          <Link href="/dashboard" className="min-w-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Image src="/brand/websitevikreta-logo-horizontal.svg" alt="Website Vikreta" width={1364} height={300} priority className="h-auto w-40 sm:w-48" />
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {role ? (
            <Badge variant="default" className="h-7 px-3 text-xs font-semibold">
              {role}
            </Badge>
          ) : null}

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowSignOut(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Sign out"
                >
                  <LogOut className="size-4" aria-hidden />
                </Button>
              }
            />
            <TooltipContent>Sign out</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Sign-out confirmation dialog */}
      <Dialog open={showSignOut} onOpenChange={setShowSignOut}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-title-md">Sign out?</DialogTitle>
            <DialogDescription>
              Are you sure you want to sign out of your account?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowSignOut(false)}
              disabled={loggingOut}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleSignOut}
              disabled={loggingOut}
            >
              {loggingOut ? "Signing out…" : "Yes, sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
