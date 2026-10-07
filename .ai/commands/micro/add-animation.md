# Command Recipe: add-animation

> Add or fix motion on one component.

## Trigger

Run the **add-animation** command recipe, or invoke `/add-animation` if your tool supports slash commands.

## Load

- `.ai/standards/motion-system.md`
- `.ai/learning.md` (logged `[Motion]` entries)
- `.ai/context/session.md`

## Input Required

- Component file path
- Element being animated
- Trigger: hover / press / open-close / data change / mount

## Execution Checklist

1. **Justify it.** Does the motion confirm an action, show origin, or ease a layer? If not, don't add it.
2. **Reuse first.** tw-animate-css classes or the shadcn component's built-in animation. No new library.
3. **Use the values** from `motion-system.md` (100 / 150 / 200 / 300ms, ease-out on enter).
4. **No motion on money values** (no count-ups, no animated digits).
5. **Reduced motion:** custom keyframes behind `motion-safe:`.
6. **Check the 50th use:** would it annoy a manager after a day of use? Shorten or cut.

## Output Validation

- [ ] Purpose stated in one line
- [ ] Duration ≤ 300ms, values from the standard
- [ ] No new dependency
- [ ] `prefers-reduced-motion` respected
- [ ] New reusable timing logged to `.ai/learning.md`
