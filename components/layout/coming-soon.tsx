interface ComingSoonProps {
  title: string;
  planned: string[];
}

/** Placeholder for modules on the roadmap that have no backend yet. */
export function ComingSoon({ title, planned }: ComingSoonProps) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-title-md">{title}</h2>
      <ul className="mt-4 space-y-2">
        {planned.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-body-sm text-muted-foreground">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
