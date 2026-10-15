"use client";

import "./globals.css";

/** Last-resort boundary when the root layout itself fails; it replaces <html>/<body>. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="grid min-h-dvh place-items-center bg-background p-6 font-sans text-foreground">
        <title>Something went wrong · Website Vikreta Finance</title>
        <section className="w-full max-w-md rounded-xl border border-border bg-card p-6" role="alert">
          <h1 className="text-title-lg">The app couldn&apos;t start this page</h1>
          <p className="mt-3 text-body-sm text-muted-foreground">Your data is safe. Try again in a moment.</p>
          {error.digest ? <p className="mt-3 font-mono text-caption text-muted-foreground">Reference: {error.digest}</p> : null}
          <button
            type="button"
            onClick={() => retry()}
            className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-active focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Try again
          </button>
        </section>
      </body>
    </html>
  );
}
