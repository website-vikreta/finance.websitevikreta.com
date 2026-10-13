"use client";

import { useEffect, useState } from "react";
import { formatCurrentHeroDate } from "@/lib/format";

export function HeroCard() {
  const [dateText, setDateText] = useState("All figures shown in INR unless noted.");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setDateText(formatCurrentHeroDate());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card p-6 md:p-8">
      <div className="absolute inset-0 bg-dot-pattern opacity-60" aria-hidden />
      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div>
          <p className="text-eyebrow flex items-center gap-2 text-muted-foreground">
            <span className="h-px w-6 bg-primary" aria-hidden />
            Finance overview
          </p>
          <h1 className="mt-4 max-w-xl text-display-sm md:text-display-md">
            Your money. <span className="text-primary">Clearly managed.</span>
          </h1>
          <p className="mt-4 text-body-sm text-muted-foreground">{dateText}</p>
        </div>
        <p className="max-w-xs text-body-sm text-muted-foreground lg:text-right">
          Ask, review, and approve when you need to. Your figures stay in view.
        </p>
      </div>
    </section>
  );
}
