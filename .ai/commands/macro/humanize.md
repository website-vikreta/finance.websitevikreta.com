# Command Recipe: humanize

> Strip AI-writing tells out of copy so it reads like a person wrote it. Run on every word a manager reads: labels, empty states, errors, toasts, confirm dialogs, chatbot replies, button text.

## Trigger

Run the **humanize** command recipe, or invoke `/humanize` if your tool supports slash commands.

## Load

- `.ai/context/brand.md` (Voice & Microcopy — the target sound)
- `.ai/learning.md` → `[Copy]` entries (density budget, logged copy rules)

## Input Required

- Text to humanize: a file path, a component path, or pasted copy.
- Optional: target tone if it differs from brand voice (default: brand voice).

## Execution Checklist

### 1. Scan
Read the text and mark every hit from the pattern table below. Quote the offending line, name the pattern.

### 2. Rewrite
Fix each hit. Keep the meaning. Keep the product voice: short, plain, exact. Say what happened and what to do next.

### 3. Read it aloud test
If a manager has to read a sentence twice to know what happened to their money, it fails. Rewrite it.

### 4. Output
- The rewritten text (applied to the file if a path was given)
- A short list of what changed and why (pattern name per fix)

## Output Validation

- [ ] Zero hits from the pattern table
- [ ] Zero em dashes in user-facing copy
- [ ] Zero curly quotes
- [ ] Every claim is either specific or deleted
- [ ] Reads aloud without cringe
- [ ] Still says what it needed to say

---

## Pattern Table — what to kill

### Content
| Pattern | Tells | Fix |
|---|---|---|
| Inflated significance | stands/serves as, testament, pivotal, key moment, underscores, reflects broader, marking a shift, evolving landscape, indelible mark, deeply rooted | Cut the whole clause. State the fact. |
| Notability padding | featured in leading outlets, active social presence, trusted by industry leaders | One specific claim with a source, or nothing. |
| Superficial `-ing` tails | highlighting…, ensuring…, reflecting…, fostering…, showcasing…, contributing to… | Delete the trailing participle phrase. |
| Promotional puff | boasts, vibrant, rich, profound, seamless, nestled, in the heart of, groundbreaking, renowned, stunning, cutting-edge, best-in-class | Replace with the concrete thing. |
| Vague attribution | industry reports, experts argue, observers note, studies show | Name the source or drop the claim. |
| Formulaic "challenges" block | Despite its… faces several challenges, Despite these challenges | Delete the section. Say the specific problem instead. |

### Language
| Pattern | Tells | Fix |
|---|---|---|
| AI vocabulary | additionally, align with, crucial, delve, enhance, foster, garner, highlight (v), interplay, intricate, key (adj), landscape (abstract), leverage, pivotal, robust, showcase, streamline, tapestry, testament, underscore, unlock, elevate | Plain word or cut. |
| Copula avoidance | serves as, stands as, represents, boasts, features, offers | Use `is` / `are` / `has`. |
| Negative parallelism | not just X, it's Y / not only… but also | State Y. Drop X. |
| Rule of three | forced triplets of nouns, verbs, adjectives | Two, or one. Three only when three things genuinely exist. |
| Synonym cycling | the platform / the solution / the system / the tool, all for one thing | Pick one noun. Repeat it. |
| False ranges | from startups to enterprises, from strategy to execution | Name what's actually covered. |

### Style
| Pattern | Fix |
|---|---|
| Em dash | Period, comma, or rewrite. No em dashes in user-facing copy. |
| Boldface sprinkling | Bold nothing, or one phrase per screen. |
| Inline-header bullet lists (`**Thing:** description`) | Prose sentence, or label + value with no bold. |
| Title Case Headings | Sentence case. **Exception: button/CTA labels are Title Case — do not touch them** (user-confirmed 2026-08-22). |
| Emojis in copy or headings | Remove. |
| Curly quotes / smart apostrophes | Straight `'` and `"`. In JSX use `&apos;` / `&quot;` where the linter requires it. |

### Chat residue
Kill on sight: "I hope this helps", "Certainly!", "Let me know if…", "Would you like…", "as of my last update", "while specific details are limited", "Great question".

### Filler and hedging
| Before | After |
|---|---|
| in order to | to |
| due to the fact that | because |
| at this point in time | now |
| has the ability to | can |
| it is important to note that | (delete) |
| could potentially possibly | may |

### Generic closers
No "the future looks bright", no "exciting times ahead", no "a step in the right direction". End on a fact or the CTA.

---

## Add voice, don't just sanitize
Clean and dead is still a fail. After the cuts:
- Vary sentence length. Short. Then one that takes its time and lands somewhere specific.
- Be specific: "Saved ₹8,500 (USD 100 at ₹85.00)" beats "Transaction saved successfully!".
- Name the thing: "Rent, Oct 2026 already exists" beats "Duplicate detected".
- Errors say what to do: "Rate service is down. Enter the rate by hand." beats "Something went wrong".

---

## Brand-specific bans (on top of the above)
From `.ai/context/brand.md`:
- No celebration copy: "Awesome!", "Great job!", "🎉", exclamation marks on routine saves.
- No vague errors: "Oops", "Something went wrong", "Invalid input" without saying which field and why.
- No jargon a manager wouldn't say: "entity", "record mutated", "payload", "null".
- Never round or reformat money in copy. Amounts in copy use the same formatter as the UI (`.ai/standards/data-safety.md`).

---

## Definition of done
- [ ] Zero hits from the pattern table
- [ ] Zero em dashes in user-facing copy
- [ ] Zero curly quotes
- [ ] Every claim is either specific or deleted
- [ ] Reads aloud without cringe
- [ ] Still says what it needed to say
