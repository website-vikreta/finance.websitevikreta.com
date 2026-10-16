"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { removeMemberAction } from "./actions";

export function RemoveMemberButton({ id, email }: { id: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    if (!next) setError(null);
    setOpen(next);
  }

  function confirm() {
    startTransition(async () => {
      const result = await removeMemberAction(id);
      if (!result.ok) return setError(result.error ?? "Couldn't remove this member.");
      change(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" aria-label={`Remove ${email}`} />}>
        <Trash2 aria-hidden />
        Remove
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-title-md">Remove {email}?</DialogTitle>
          <DialogDescription>They will be signed out and won&apos;t be able to log in. You can add them again later.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => change(false)} disabled={pending}>
            Keep
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
