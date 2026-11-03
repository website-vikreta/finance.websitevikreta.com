/** The Finance Chat Bot's face. Blink/smile animation only runs inside `.bot-fab` (see globals.css). */
export function BotFace({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M16 4v3" />
      <circle cx="16" cy="3.5" r="1.2" fill="currentColor" stroke="none" />
      <rect x="5" y="8" width="22" height="18" rx="7" />
      <g className="bot-eyes" fill="currentColor" stroke="none">
        <circle cx="12" cy="15" r="1.8" />
        <circle cx="20" cy="15" r="1.8" />
      </g>
      <path className="bot-smile" d="M12 20q4 3.5 8 0" />
    </svg>
  );
}
