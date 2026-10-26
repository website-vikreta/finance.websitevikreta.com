import { cn } from "@/lib/utils";

export function PrintSection({
  title,
  children,
  breakable = false,
}: {
  title: string;
  children: React.ReactNode;
  breakable?: boolean;
}) {
  return (
    <section className={cn("mt-7", !breakable && "break-inside-avoid")}>
      <h2 className="border-b-2 border-primary pb-1 text-title-sm">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export type PrintCell = string;

export interface PrintTableRow {
  key: string;
  cells: PrintCell[];
  strong?: boolean;
  /** Colours the last (amount) cell red. */
  negative?: boolean;
}

export function PrintTable({
  head,
  align,
  rows,
}: {
  head: string[];
  align: ("left" | "right")[];
  rows: PrintTableRow[];
}) {
  const alignClass = (i: number) => (align[i] === "right" ? "text-right whitespace-nowrap" : "text-left");
  return (
    <table className="w-full border-collapse text-caption font-normal">
      <thead>
        <tr className="bg-foreground text-background">
          {head.map((h, i) => (
            <th key={i} scope="col" className={cn("px-2.5 py-1.5 font-semibold", alignClass(i))}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={cn("break-inside-avoid border-b border-border even:bg-muted", r.strong && "font-semibold")}>
            {r.cells.map((c, i) => (
              <td
                key={i}
                className={cn(
                  "px-2.5 py-1.5 align-top tabular-nums",
                  alignClass(i),
                  i === r.cells.length - 1 && r.negative && "text-destructive",
                )}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
