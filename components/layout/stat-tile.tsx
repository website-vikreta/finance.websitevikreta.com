interface StatTileProps {
  label: string;
  value: string;
  note?: string;
}

/** Small figure tile for page summaries (Clients, Reports). The dashboard uses the larger KPICard. */
export function StatTile({ label, value, note }: StatTileProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-eyebrow text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-title-lg tabular-nums text-foreground">{value}</p>
      {note ? <p className="mt-1 text-caption text-muted-foreground">{note}</p> : null}
    </div>
  );
}
