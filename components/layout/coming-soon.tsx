interface ComingSoonProps {
  eyebrow: string;
  title: string;
  description: string;
  planned: string[];
}

/** Honest placeholder for modules on the roadmap that have no backend yet. */
export function ComingSoon({ eyebrow, title, description, planned }: ComingSoonProps) {
  return (
    <section className="rounded-xl border border-border bg-card p-6 md:p-8">
      <p className="text-eyebrow flex items-center gap-2 text-muted-foreground">
        <span className="h-px w-6 bg-primary" aria-hidden />
        {eyebrow}
      </p>
      <h2 className="mt-4 text-title-lg md:text-display-sm">{title}</h2>
      <p className="mt-3 max-w-2xl text-body-sm text-muted-foreground">{description}</p>
      <ul className="mt-6 space-y-2">
        {planned.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-body-sm text-foreground">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
