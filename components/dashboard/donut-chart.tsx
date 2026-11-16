"use client";

interface DonutDatum {
  name: string;
  amount: number;
  color: string;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 2; // px of card-coloured space between slices

/** Donut drawn with SVG circle strokes: no charting library on the dashboard. */
export function DonutChart({
  data,
  hovered,
  onHover,
}: {
  data: DonutDatum[];
  hovered: number | null;
  onHover: (index: number | null) => void;
}) {
  const total = data.reduce((sum, slice) => sum + slice.amount, 0);
  const segments = data.map((slice, index) => {
    const fraction = total > 0 ? slice.amount / total : 0;
    const offset = data
      .slice(0, index)
      .reduce((sum, before) => sum + (total > 0 ? before.amount / total : 0) * CIRCUMFERENCE, 0);
    return { slice, fraction, offset };
  });

  return (
    <svg className="size-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
      {segments.map(({ slice, fraction, offset }, i) => {
        const length = Math.max(fraction * CIRCUMFERENCE - GAP, 0);
        return (
          <circle
            key={slice.name}
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={slice.color}
            strokeWidth={14.8}
            strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
            strokeDashoffset={-offset}
            opacity={hovered === null || hovered === i ? 1 : 0.35}
            className="cursor-pointer transition-opacity"
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
          />
        );
      })}
    </svg>
  );
}
