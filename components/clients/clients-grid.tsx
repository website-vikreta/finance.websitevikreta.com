"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { formatDate, formatINR, formatShare } from "@/lib/format";
import type { ClientSummary } from "@/lib/transactions/queries";

const SORTS = {
  received: { label: "Received", compare: (a: ClientSummary, b: ClientSummary) => b.totalReceived - a.totalReceived },
  recent: {
    label: "Last payment",
    compare: (a: ClientSummary, b: ClientSummary) => (b.lastPaymentDate ?? "").localeCompare(a.lastPaymentDate ?? ""),
  },
  name: { label: "Name", compare: (a: ClientSummary, b: ClientSummary) => a.name.localeCompare(b.name) },
} as const;

type Sort = keyof typeof SORTS;

export function ClientsGrid({ clients }: { clients: ClientSummary[] }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("received");
  const totalReceived = clients.reduce((s, c) => s + c.totalReceived, 0);
  const query = search.trim().toLowerCase();
  const visible = clients.filter((c) => c.name.toLowerCase().includes(query)).sort(SORTS[sort].compare);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="relative w-full @2xl:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" aria-label="Search clients" className="pl-9" />
        </div>
        <div role="tablist" aria-label="Sort clients" className={segmentedTrack}>
          {(Object.keys(SORTS) as Sort[]).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={sort === key} onClick={() => setSort(key)} className={segmentedItem(sort === key)}>
              {SORTS[key].label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-6 py-10 text-center text-body-sm text-muted-foreground">
          No clients match &ldquo;{search.trim()}&rdquo;.
        </p>
      ) : (
          <ul className="grid grid-cols-1 gap-6 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {visible.map((c) => {
              const share = totalReceived > 0 ? (c.totalReceived / totalReceived) * 100 : 0;
              const shareLabel = formatShare(c.totalReceived, totalReceived);
              return (
                <li key={c.id} className="flex flex-col rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-caption font-semibold text-foreground" aria-hidden>
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-title-sm">{c.name}</h2>
                      <p className="text-caption text-muted-foreground">Client since {formatDate(c.firstSeen)}</p>
                    </div>
                  </div>

                  <dl className="mt-5 space-y-2 border-t border-border pt-4 text-body-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Received</dt>
                      <dd className="font-mono font-semibold tabular-nums text-foreground">{formatINR(c.totalReceived)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Payments</dt>
                      <dd className="tabular-nums text-foreground">{c.payments}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Last payment</dt>
                      <dd className="text-foreground">{c.lastPaymentDate ? formatDate(c.lastPaymentDate) : "None yet"}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${shareLabel} of all income`}>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                  </div>
                  <p className="mt-1.5 text-caption text-muted-foreground">{shareLabel} of all income</p>
                </li>
              );
            })}
          </ul>
      )}
    </div>
  );
}
