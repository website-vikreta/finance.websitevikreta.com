"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SignOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Split out of the navbar so the dialog library is only fetched when signing out. */
export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  const handleSignOut = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout");
    } catch {
      // The cookie may already be gone; still leave the app.
    }
    router.replace("/login");
  }, [loggingOut, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={() => onOpenChange(false)}
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
  );
}
