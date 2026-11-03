"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

/** Catches render and data errors on any page and keeps the app shell around the message. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppShell>
      <section className="rounded-xl border border-border bg-card p-6 md:p-8" role="alert">
        <h1 className="text-title-lg">Couldn&apos;t load this page</h1>
        <p className="mt-2 text-body-sm text-muted-foreground">Nothing was changed.</p>
        {error.digest ? <p className="mt-3 font-mono text-caption text-muted-foreground">Reference: {error.digest}</p> : null}
        <Button className="mt-6" onClick={() => retry()}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
      </section>
    </AppShell>
  );
}
