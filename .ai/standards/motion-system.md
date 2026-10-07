# Motion System — Finance Tool

## Philosophy
This is a tool people use many times a day. Motion confirms an action, shows where something came from, or eases a layer in and out. It never decorates and never makes anyone wait.

**The rule:** if a manager would notice the animation on the 50th use, it is too much.

---

## Values
```
Durations
  micro   100ms   hover, press, focus
  fast    150ms   menus, tooltips, popovers (shadcn default: duration-100/150)
  base    200ms   dialogs, sheets, tab content
  slow    300ms   row insert highlight fade, chart first draw (max)

Easing
  out     cubic-bezier(0.16, 1, 0.3, 1)   entering
  in      cubic-bezier(0.7, 0, 0.84, 0)   leaving
  linear  only for progress bars
```

## Tools
- **tw-animate-css** (installed): `animate-in fade-in-0 zoom-in-95 slide-in-from-*`. shadcn overlays already use it. Reuse, don't re-implement.
- **CSS transitions** for hover/focus: `transition-colors duration-100`.
- No GSAP. No Framer Motion. No scroll-triggered reveals. Add a library only with an approved reason logged in `learning.md`.

## Patterns
| Moment | Treatment |
|--------|-----------|
| Hover on rows / ghost buttons | `transition-colors duration-100` to `bg-accent` |
| Button press | built-in `active:translate-y-px` |
| Menus, popovers, tooltips | shadcn defaults (fade + zoom-95, ~100–150ms) |
| Dialog / sheet | shadcn defaults (200ms) |
| New transaction saved | Row appears at top; background flashes `bg-primary/10` → transparent over 300ms. Totals update in place, no count-up |
| Chatbot typing | 3-dot pulse, `animate-pulse`. No spinners on the whole screen |
| Loading data | `<Skeleton>` at final size. No spinners for page loads |
| Charts | Draw once on mount (≤300ms) or not at all. No re-animating on filter change |

## Never
- Count-up animations on money. A manager must read the real number instantly.
- Animating text color, layout shifts, bounces, springs with overshoot.
- Looping or ambient motion.
- Delaying content to show an animation.

## Reduced Motion
Wrap any custom keyframe in `motion-safe:`. tw-animate-css and shadcn respect `prefers-reduced-motion` already. Information must never depend on motion.
