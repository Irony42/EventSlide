# ADR 0006 — Own the design system instead of loading Bootstrap from a CDN

## Status

Accepted. Supersedes the Bootstrap 5.3 CDN link and `public/app.css` of 1.0. Paths
refer to the 2.0 layout ([CLAUDE.md](../../CLAUDE.md) §4); items marked
**(planned)** are designed here, not built.

## Date

2026-09-09

## Context

1.0 had no design system. It had a CDN link and a pile of overrides on top of it:

```html
<!-- index.html -->
<link
  href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
  rel="stylesheet"
/>
<link rel="stylesheet" href="/app.css" />
```

`public/app.css` then spent 186 lines fighting it. Every symptom below is measurable
in the 1.0 tree, not a hypothetical.

| Symptom                              | Evidence                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colours duplicated as literals       | `#e2e8f0` in 3 rules, `#cbd5e1` in 3, plus `#0f172a`, `#1e293b`, `#0b1120`, `#94a3b8`, `#f8fafc`, `#38bdf8`, `#fca5a5`, `#86efac`, `#22c55e`, `#ef4444`, `#000`, and 6 different `rgba(15, 23, 42, …)` alphas                                     |
| Specificity fights                   | `.app-card .form-label, .app-card .h1, … .app-card .h6 { color: #e2e8f0 }`, plus one outright surrender: `.app-card .form-text { color: #94a3b8 !important }`                                                                                     |
| Design decisions in markup, not CSS  | `btn` ×10, `form-control` ×9, `form-label` ×8, `mb-4` ×12, `mb-3` ×9, `d-flex` ×6 in JSX class strings                                                                                                                                            |
| Static values inlined in components  | 10 `style={{ … }}` sites in 5 files: `width: '80px', borderRadius: '8px'` (`src/frontend/components/UploadForm.tsx:67`), `height: '50px'` (`src/frontend/pages/AdminDashboardPage.tsx:14`), `background: 'rgba(0,0,0,0.2)'` (`UploadForm.tsx:61`) |
| No theming seam                      | Nothing is parameterised, so a wedding and a conference both get the same violet-slate gradient                                                                                                                                                   |
| Contrast unauditable                 | Foreground and background literals live in different rules in different files. "Does muted text pass AA on the raised surface?" needs all 186 lines read                                                                                          |
| Colour as the only signal            | `.image-container.accepted { border-color: #22c55e }` vs `.rejected { border-color: #ef4444 }` — indistinguishable to a red-green colourblind host under stage lighting                                                                           |
| First paint blocked on a third party | A render-blocking stylesheet from `cdn.jsdelivr.net`, on venue Wi-Fi shared with 150 guests uploading photos. A blocked CDN meant an unstyled page, not a slower one                                                                              |
| Strict CSP impossible                | A remote `style-src` origin is mandatory, so `style-src 'self'` can never be set. 1.0 had no CSP at all — `grep -rn helmet src/` returns nothing                                                                                                  |
| No typography decision               | No `font-family` and no `@font-face` anywhere in 1.0; the product's type was whatever Bootstrap Reboot chose                                                                                                                                      |

CLAUDE.md §3 rule 2 and AGENTS.md constraints 2 and 11 already forbid untokenised
style values and remote `<link>`/`<script>`. This ADR records why, and what must exist
for those rules to be satisfiable.

## Decision

Own the visual layer. No Bootstrap, no CDN, no remote font.

```
web/src/design-system/
  tokens.css      the ONLY file holding a literal colour, space, type, radius, shadow, duration
  reset.css       ~40 lines replacing Bootstrap Reboot: box-sizing, margins, media defaults, focus-visible
  fonts.css       @font-face over self-hosted .woff2 sitting next to it
  components/     one primitive per file pair: Button.tsx + Button.module.css
```

1. **Tokens are CSS custom properties in `oklch`.** Perceptually uniform lightness
   means `--text-secondary` holds the same apparent contrast against every surface and
   a hue change does not shift perceived brightness. The reference set is in
   `.claude/skills/eventslide-ui-component/SKILL.md`; it is dark-first, because the
   room is dark and phones are held in it.
2. **Roughly fifteen primitives with colocated CSS Modules:** `Button`, `IconButton`,
   `Field`, `TextInput`, `Textarea`, `Card`, `Dialog`, `Toast`, `Spinner`,
   `EmptyState`, `Badge`, `Progress`, `VisuallyHidden`, `Stack`, `Grid`. No global
   class names outside `reset.css` and `tokens.css`, so there is no specificity war to
   win and no `!important` anywhere.
3. **Bootstrap's vocabulary is replaced by components, not by our own utility soup:**

   | 1.0                                                | 2.0                                                                      |
   | -------------------------------------------------- | ------------------------------------------------------------------------ |
   | `btn btn-primary btn-lg`                           | `<Button variant="primary" size="lg">`                                   |
   | `form-label` / `form-control` / `form-text`        | `<Field>` wrapping `<TextInput>`                                         |
   | `card` / `card-body`                               | `<Card>`                                                                 |
   | `container` / `row` / `col-*`                      | `<Stack>`, `<Grid>`, or `grid-template-columns` in the page's own module |
   | `d-flex` + `mb-3` + `gap-2`                        | `<Stack gap="3">`, or module rules using `var(--space-3)`                |
   | `progress` / `progress-bar`                        | `<Progress value>`                                                       |
   | `window.confirm(…)` (`ModerationImageCard.tsx:15`) | `<Dialog>`                                                               |

4. **Enforced mechanically, because review does not catch the eleventh `#e2e8f0`.**
   stylelint restricts colour and spacing properties to values matching `^var\(--`,
   with `tokens.css` the single exemption in `overrides`. eslint adds a
   `no-restricted-syntax` rule on
   `JSXAttribute[name.name="style"] ObjectExpression > Property > Literal`, which
   rejects `style={{ height: '50px' }}` but still allows a genuinely computed value —
   a template literal or a conditional is not a `Literal` node, so
   `SlideshowCanvas.tsx`'s computed `backgroundImage` pattern stays legal. Both run
   inside `npm run lint`, which `npm run verify` gates on.
5. **Per-event theming is a token override applied through the CSSOM**, not generated
   CSS: the event's `settings` column carries an optional accent, the client validates
   it with zod, then calls `root.style.setProperty('--accent', value)`. CSP does not
   restrict CSSOM writes, whereas interpolating a colour into a `<style>` tag would
   require `style-src 'unsafe-inline'` and turn event settings into an injection sink.
6. **Fonts are self-hosted** `.woff2` with `font-display: swap` and a real fallback
   stack declared in `tokens.css`. No `fonts.googleapis.com`, no `fonts.gstatic.com`.

**(planned)** — none of `web/src/` exists in this tree yet; 2.0 is being built beside
the 1.0 code it replaces, so everything above is design, not description. The contrast
audit is planned too: a test that parses `tokens.css` and fails below 4.5:1 for body
text and 3:1 for large text and borders.

## Consequences

### Positive

- **First paint needs no third-party request.** Everything ships in the Vite bundle
  from the same origin as the API — the point that matters most, on venue Wi-Fi.
- **A strict CSP becomes expressible.** `helmet` in `src/interface/http/middleware/`
  can set `default-src 'self'`, `script-src 'self'`, `style-src 'self'`,
  `font-src 'self'`, `connect-src 'self'`, `img-src 'self' blob:` with no
  `unsafe-inline` and no remote origin.
- **Theming an event is one property write**: no rebuild, no per-event stylesheet, no
  server-rendered CSS.
- **Contrast is auditable in one file** — every foreground and surface is an `oklch`
  lightness in `tokens.css`.
- **The three surfaces can diverge honestly.** `--touch-min: 2.75rem` for a guest's
  thumb and `--text-display` legible at 3–10 m are token decisions; Bootstrap's laptop
  defaults fought both.

### Negative

- **We implement and test ~15 primitives**, including their loading, empty, and error
  states, before the first feature screen. Bootstrap gave that away.
- **We own accessibility behaviour that came for free.** `<Dialog>` needs a focus trap,
  focus restore on close, `Escape`, `aria-modal`, and an inert background; `<Toast>`
  needs an `aria-live` region that announces once and is not stolen by the next toast.
  1.0 dodged this with `window.confirm` — accessible, unstyleable, and blocking.
- **No grid, no utility classes.** Layout moves into page-level CSS Modules, and if we
  are undisciplined it regrows as a private utility framework with none of Bootstrap's
  documentation. The primitives-first rule in `eventslide-ui-component` exists for this.
- **`oklch` sets a browser floor** (Safari 15.4+, Chrome 111+, Firefox 113+) and guests
  bring whatever phone they own. Mitigation: an `@supports not (color: oklch(0% 0 0))`
  block redefining the same custom properties in `rgb()`, checked on a real old device
  rather than assumed.
- **No third-party answers.** Every styling question is now a question about our code.

### Neutral

- Dev and production need different CSP values: Vite injects styles through JS in dev,
  so strict `style-src 'self'` applies to the built bundle while the dev server runs a
  looser policy. A ring-4 test must assert the production header so the two do not
  silently converge.
- `tokens.css` becomes a coordination point. Adding a token is a design decision: the
  bar is a genuinely new _role_, never a new shade.
- CSS grows per primitive instead of arriving as one framework file. Total bytes drop,
  but they become our line item.

## Alternatives considered

### Bootstrap bundled locally instead of via CDN

Fixes the CSP and the network dependency and nothing else. The 186 lines of overrides,
the `!important` surrender, and the class strings in JSX all survive verbatim; theming
becomes "recompile Sass variables"; contrast stays split across their rules and ours.
The product also keeps the visual identity of a Bootstrap site, which is wrong for a
full-bleed wall where the UI should recede behind guests' photos.

### Tailwind

The play-CDN script is the same CSP problem in a different tag. A build-time setup
fixes that but moves design decisions back into markup — the `mb-4`-in-JSX pattern that
made 1.0 unthemable, with more classes. Our binding rule is the opposite arrangement:
raw values in one file, components consuming `var(--…)`. It also leaves the work we
actually need undone, since Tailwind ships no accessible `Dialog` or `Toast`.

### A component library (MUI, Mantine)

Genuinely tempting for the host console, and it would solve the primitives and much of
the accessibility work. Rejected on weight, on a guest surface whose whole requirement
is a fast first paint over congested Wi-Fi; and on look — an opinionated Material or
app-shell aesthetic with elevation and dense chrome competes with a screen that should
be black, quiet, and entirely photograph. Their runtime CSS-in-JS variants also
reintroduce inline `<style>` injection, which is the CSP problem again.

## Related

- `index.html` and `public/app.css` — the 1.0 arrangement this replaces
- `.claude/skills/eventslide-ui-component/SKILL.md` — tokens, primitives, a11y rules
- [docs/DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) — the token catalogue itself
- [docs/SECURITY.md](../SECURITY.md) — the CSP this decision makes possible
- [CLAUDE.md](../../CLAUDE.md) §3 rule 2 and §8; [AGENTS.md](../../AGENTS.md)
  constraints 2 and 11
