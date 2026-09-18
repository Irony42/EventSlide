# DESIGN-SYSTEM.md — EventSlide 2.0

The visual contract. Read this before writing any CSS or any component in `web/src`.
Companion recipe: `.claude/skills/eventslide-ui-component/SKILL.md`. Binding rules:
[CLAUDE.md](../CLAUDE.md) §3.2 and [AGENTS.md](../AGENTS.md) constraint 2.

> **Status.** The 1.0 frontend (`src/frontend`, `public/app.css`) was removed in
> `fa6e9bd`. Everything below is implemented: `web/src/design-system/` holds the tokens
> and the primitives, and all four surfaces are built on them. The contrast targets in
> §8 are enforced by a test rather than asserted here — see the end of that section,
> including the one pair that does not meet its target and why.

---

## 1. Principles, for this product

Four constraints, in priority order. When two conflict, the higher one wins.

| #   | Principle                                                                                        | What it forbids in practice                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **The photo is the hero; chrome recedes.** A guest's photo is the only content with real colour. | Coloured panels behind photos, decorative gradients on the wall, borders that compete with the image, a logo on the projected surface larger than `--text-lg`.                 |
| 2   | **The guest has one thumb and a drink in the other hand, in a dark room.**                       | Targets under `var(--touch-min)`, controls in the top half of a phone screen, hover-only affordances, multi-step forms, anything requiring two hands or precision.             |
| 3   | **The wall is read from 3–10 m and runs unattended for hours.**                                  | Captions below `--text-xl`, text on a busy photo without a scrim, anything that needs a click to recover, unbounded lists, spinners that spin forever after the network drops. |
| 4   | **Celebration without noise.** Warm and quiet, not a slot machine.                               | Confetti loops, bouncing icons, more than one accent hue, emoji in system copy, exclamation marks as decoration, sounds.                                                       |

Surfaces are listed in [CLAUDE.md](../CLAUDE.md) §1. Their visual brief is one line
each: guest = one column, one primary action; host = density and keyboard; room = photo
edge to edge, no input device assumed.

---

## 2. Tokens

`web/src/design-system/tokens.css` is **the only file allowed to contain a raw colour,
spacing, radius, shadow, font size, duration or easing curve.** Everything else uses
`var(--…)`; a literal `#38bdf8` in a component fails review even when it matches a
token exactly.

```css
/* web/src/design-system/tokens.css */
:root {
  color-scheme: dark;

  /* ---- Surfaces. Dark by default: the room is dark and phones are held in it. ---- */
  --surface-base: oklch(16% 0.02 265); /* page background, wall letterbox */
  --surface-raised: oklch(21% 0.025 265); /* Card, toolbar, moderation tile */
  --surface-overlay: oklch(26% 0.03 265); /* Dialog, Toast, popover */
  --surface-scrim: oklch(0% 0 0 / 0.55); /* behind wall captions, over photos */
  /* ---- Print. A material, not a panel: the paper the polaroid layout mounts a photo
         on. It is the one light ground in a dark palette, so it gets its own ink token
         rather than borrowing a text colour chosen against a dark surface. ---- */
  --surface-print: oklch(95% 0.012 85); /* polaroid mat, warm white */
  --text-print: oklch(30% 0.02 85); /* the caption written on the mat */
  --text-print-secondary: oklch(40% 0.02 85); /* the credit under it */
  /* ---- Borders ---- */
  --border-subtle: oklch(30% 0.02 265); /* default hairline */
  --border-strong: oklch(54% 0.02 265); /* input rest state, focused card */
  /* ---- Text ---- */
  --text-primary: oklch(97% 0.005 265);
  --text-secondary: oklch(78% 0.015 265);
  --text-muted: oklch(64% 0.02 265);

  /* ---- Accent. One hue, and it is the one thing an event may move (§12). ---- */
  --accent-hue: 305;
  /* ---- Semantic. Fixed hues: an event's accent may not crowd them. ---- */
  --success: oklch(76% 0.16 155);
  --danger: oklch(68% 0.19 22);
  --warning: oklch(82% 0.15 85);
  /* ---- Focus. The ring is derived from the accent, so it is declared with it. ---- */
  --focus-offset: 2px;

  /* ---- Space. 4 px base. No in-between values. ---- */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-8: 3rem;
  --space-10: 4rem;

  /* ---- Type. Fluid, so the phone and the projector both read well. ---- */
  --font-sans:
    'InterVariable', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI',
    Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
  --font-display: var(--font-sans); /* the wall's display face; §12 moves it */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: clamp(1.125rem, 0.4vw + 1rem, 1.25rem);
  --text-xl: clamp(1.5rem, 1vw + 1.2rem, 2rem);
  --text-display: clamp(2rem, 3vw + 1rem, 4rem);
  --leading-tight: 1.15; /* --text-xl and --text-display only */
  --leading-snug: 1.35; /* wall captions, card titles */
  --leading-normal: 1.55; /* body */
  --tracking-tight: -0.02em; /* --text-display only */

  /* ---- Radii ---- */
  --radius-none: 0;
  --radius-sm: 0.375rem;
  --radius-md: 0.75rem;
  --radius-lg: 1.25rem;
  --radius-full: 999px;
  --wall-frame-radius: var(--radius-md); /* a framed photo's corner; §12 moves it */

  /* ---- Shadows. Elevation is the only thing shadows encode. ---- */
  --shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.3);
  --shadow-md: 0 8px 24px -8px oklch(0% 0 0 / 0.45);
  --shadow-lg: 0 24px 60px -12px oklch(0% 0 0 / 0.55);

  /* ---- Glass. A material, so a set rather than a value (§13). Each tint's alpha is a
         floor derived from §8, not a taste; the fallback is --surface-raised itself, and
         so is every tint — one colour, three alphas. ---- */
  --glass-blur: 20px;
  --glass-saturate: 180%;
  --glass-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  --glass-tint-photo: oklch(21% 0.025 265 / 0.95); /* over an unknown photograph */
  --glass-tint-ground: oklch(21% 0.025 265 / 0.92); /* over our own ground */
  --glass-tint: var(--glass-tint-photo); /* the strict floor is the default */
  --glass-opaque: var(--surface-raised);
  --glass-border: oklch(97% 0.005 265 / 0.16);
  --glass-highlight: oklch(97% 0.005 265 / 0.1);
  --glass-shadow: inset 0 1px 0 0 var(--glass-highlight), var(--shadow-lg);

  /* ---- Motion ---- */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1); /* things entering */
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1); /* things moving */
  --ease-linear: linear; /* Ken Burns, progress */
  --duration-fast: 140ms; /* press feedback, focus */
  --duration-base: 240ms; /* dialogs, toasts, tile state */
  --duration-slow: 520ms; /* wall crossfade */

  /* ---- Layout ---- */
  --container-guest: 30rem; /* single column, phone-first */
  --container-host: 78rem; /* moderation console, admin */
  --wall-safe: 4%; /* projector overscan inset */
  --wall-join-card: 26rem; /* the corner invitation: declared, so layouts can reserve it */
  --z-wall-caption: 10;
  --z-dialog: 50;
  --z-toast: 60;

  /* ---- Targets. 44 px is the floor, not the aspiration. ---- */
  --touch-min: 2.75rem;
}

/* The accent, derived wherever a hue is in force. Two selectors, one rule — see §12:
   a custom property that references another is resolved on the element it is declared
   on, so `:root` alone would freeze the palette at the product's own hue. */
:root,
[data-event-accent] {
  --accent: oklch(72% 0.17 var(--accent-hue));
  --accent-strong: oklch(64% 0.19 var(--accent-hue)); /* hover / pressed */
  --accent-contrast: oklch(18% 0.02 var(--accent-hue)); /* text on top of --accent */
  --focus-ring: 0 0 0 3px oklch(72% 0.17 var(--accent-hue) / 0.65);
}

/* The two per-event choices that are a closed set rather than a number (§12). */
[data-event-fonts='serif'] {
  --font-display:
    ui-serif, Georgia, 'Iowan Old Style', Cambria, 'Times New Roman', serif;
}
[data-event-frame='square'] {
  --wall-frame-radius: var(--radius-none);
}
[data-event-frame='round'] {
  --wall-frame-radius: var(--radius-lg);
}

/* The glass budget (§13). Three ways to reach one fallback: a browser without the
   capability, a person who asked for less transparency or more contrast, and the room.
   The first two move the *named* tints rather than --glass-tint, because a tier below is
   declared on a descendant and would otherwise overrule them (§13). */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  :root {
    --glass-filter: none;
    --glass-tint-photo: var(--glass-opaque);
    --glass-tint-ground: var(--glass-opaque);
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  :root {
    --glass-filter: none;
    --glass-tint-photo: var(--glass-opaque);
    --glass-tint-ground: var(--glass-opaque);
  }
}
[data-glass='ground'] {
  --glass-tint: var(--glass-tint-ground);
}
[data-glass='opaque'] {
  --glass-filter: none;
  --glass-tint: var(--glass-opaque);
}
```

Rules for changing this file:

- Add a token for a new **role**, never for a new shade. A fifth grey between
  `--surface-raised` and `--surface-overlay` is a rejected change.
- Derive states by moving lightness only, same hue and chroma: `--accent-strong` is
  `--accent` at `64%` instead of `72%`.
- No `!important` (one exception, §7), no `:root` overrides in a feature folder, no
  second token file.
- The only custom properties set from JavaScript are the ones that are genuinely
  **computed**, and every one of them is a duration, a position or an angle — never a
  colour, a size or a spacing. Today: `--progress-value`, and on the wall
  `--wall-kenburns-duration` (§7), `--wall-transition`, `--wall-drift-duration` (the
  filmstrip's travel, timed from the slide interval), `--wall-tilt` (a polaroid's
  angle, derived from the photo id so two projectors agree) and `--accent-hue` (§12 —
  an angle, which is the whole reason an event's colour can be one number). Everything
  else is static CSS.

---

## 3. Why `oklch`

`oklch(L C H)` separates perceptual lightness (`L`) from chroma and hue.

| Consequence                                                                 | Why it matters here                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `L` tracks apparent brightness, unlike HSL's `l` or a hex value.            | One `--text-secondary` at `78%` holds its apparent contrast on `--surface-base` (16%), `--surface-raised` (21%) and `--surface-overlay` (26%). Under hex, 1.0 ended up with four "light text" greys (`#cbd5e1`, `#e2e8f0`, `#94a3b8`, `#f8fafc`) because none looked right on every panel. |
| Lightness changes do not shift hue, and chroma is independent of lightness. | Hover and pressed states are one number from the base token; darkening a hex purple desaturates it, so 1.0 would have needed a hand-picked second colour.                                                                                                                                  |
| Wide-gamut ready.                                                           | The projector may be a wide-gamut panel; `oklch` addresses colours outside sRGB without rewriting the palette.                                                                                                                                                                             |

Decision: **no hex fallback layer.** `oklch` ships in Chrome 111+, Safari 15.4+ and
Firefox 113+, and the browsers in scope are evergreen; a duplicated fallback palette is
exactly the drift this section prevents. If that requirement changes, the fallback goes
in `tokens.css` behind `@supports not (color: oklch(0% 0 0))`, nowhere else.

---

## 4. Typography

> **This section described a font that is not in the tree, and the correction is the
> interesting part.** It specified Inter Variable, self-hosted, with an `@font-face` block
> and a path — and `web/src/design-system/fonts/` does not exist, there is no `.woff2`
> anywhere in the repository, and `grep -rn "@font-face" web/` is empty. `'InterVariable'`
> survives only as the first name in `--font-sans`, where it matches nothing and falls
> through. **Every surface of this product renders in a system face today**, and has since
> 2.0 shipped. Corrected while roadmap 2.2 was deciding what a "font pairing" costs, where
> the difference between one bundled family and none is the whole decision.

**Face: the system UI face, through a stack.** `--font-sans` names `InterVariable` and
`Inter` first, so a machine that happens to have Inter installed uses it; everything else
resolves to `ui-sans-serif` / `system-ui` — Segoe UI on Windows, SF on Apple, Roboto on
Android. Nothing is downloaded, and no CDN: the `helmet` CSP forbids a remote `<link>` and
a venue's Wi-Fi would drop it anyway.

**Bundling Inter is still the right change, and it is not free.** A latin + latin-ext
variable `woff2` is on the order of 100 KB, against an initial JavaScript bundle measured
at 245 KB — so one face is roughly 40% of what a guest downloads today, on the surface
whose whole design constraint is a saturated access point. That is a decision with a
number attached, and it belongs in a change of its own rather than inside a theming point.
Whoever makes it needs the two notes the old block got right:

- Subset **latin + latin-ext**: French needs `é è ê à â ç î ï ô ù û œ` and the narrow
  no-break space; a `latin`-only subset drops `œ` and falls back mid-word.
- `font-display: swap`, so the stack above renders first and nothing waits on a font.

Until then, two rules that hold either way:

- The fallback stack is load-bearing, because today it is the _only_ stack.
- `font-variant-numeric: tabular-nums` on every counter (queue, quota, progress), so
  digits do not reflow as they change.

| Token            | Size     | Leading                               | Used for                          | Minimum surface                                                       |
| ---------------- | -------- | ------------------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| `--text-xs`      | 12 px    | `--leading-normal`                    | Badge text, timestamps            | host only                                                             |
| `--text-sm`      | 14 px    | `--leading-normal`                    | Field help, secondary labels      | guest, host (never on the wall)                                       |
| `--text-base`    | 16 px    | `--leading-normal`                    | Body, inputs, button labels       | all — never below 16 px on an `<input>`, iOS zooms the page otherwise |
| `--text-lg`      | 18–20 px | `--leading-snug`                      | Card titles, guest primary copy   | guest, host                                                           |
| `--text-xl`      | 24–32 px | `--leading-tight`                     | **Wall caption floor**            | room                                                                  |
| `--text-display` | 32–64 px | `--leading-tight`, `--tracking-tight` | Join code, event name on the wall | room                                                                  |

Projector minimums, non-negotiable: nothing below `--text-xl` on `/e/:slug/display`,
join code and event name at `--text-display`, captions under 40 characters per line.

**`--font-display` is the wall's display face, and it is a role rather than a second
family.** It resolves to `--font-sans` until an event's theme moves it (§12), and it is
consumed by exactly two declarations: the event name on the invitation
(`WallEmptyState.module.css`) and the caption text shared by every layout that prints one
(`SlideCaption.module.css`). Not the join code — that is transcribed character by
character from across a room, and a host's taste is not worth a `1` that could be an `l`
— and not the credit under a caption, because a pairing is two faces doing different
jobs rather than one face applied to everything.

---

## 5. Primitive catalogue

`web/src/design-system/components/`. Check for a primitive before writing one — a
fourth bespoke button is how a design system dies. Each is a `.tsx` plus a colocated
CSS Module, `forwardRef` if focusable.

| Primitive        | Purpose                                                                                                        | Accessibility requirement it carries                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`         | Every action. Variants `primary` \| `secondary` \| `ghost` \| `danger`; sizes `sm` \| `md` \| `lg`; `loading`. | Real `<button type>`. `loading` sets `aria-busy` and keeps the label — a spinner-only button announces nothing. `disabled` when loading. Never `outline: none`.            |
| `IconButton`     | Icon-only affordance (close, delete, next).                                                                    | `aria-label` is required by the type, not optional. Hit area ≥ `var(--touch-min)` even when the glyph is 16 px. Icon is `aria-hidden`.                                     |
| `Field`          | Label + control + help + error wrapper.                                                                        | Renders `<label for>`, wires `aria-describedby` to help text and `aria-invalid` + `role="alert"` to the error. Placeholder is never a label.                               |
| `TextInput`      | Single-line text, join code, e-mail.                                                                           | `font-size: var(--text-base)` minimum, correct `inputMode` / `autoComplete`; error state is border **and** text, never border alone.                                       |
| `Textarea`       | Photo caption.                                                                                                 | Auto-grow without losing caret position; character counter is `aria-live="polite"`, not a bare `<span>`.                                                                   |
| `Card`           | Grouped content on `--surface-raised`.                                                                         | A card is a `<section>` or `<article>` with a heading, or it is a `<div>` with no interactive behaviour. A clickable Card is forbidden — put a Button or a link inside it. |
| `Dialog`         | Confirmations, join-code entry, photo detail.                                                                  | Native `<dialog>` with `showModal()`: focus trap, `Escape`, `aria-labelledby`, focus returned to the opener. Replaces every `window.confirm` from 1.0.                     |
| `Toast`          | Transient result of an action.                                                                                 | `role="status"` (`role="alert"` for failures), `aria-live` region mounted once at the app root; never the only place an error appears, since it disappears.                |
| `Spinner`        | Indeterminate wait.                                                                                            | `aria-hidden` always — the surrounding element owns `aria-busy` or the live-region text. Never the sole content of the wall.                                               |
| `EmptyState`     | Zero-item state with the next action.                                                                          | Heading + one sentence + at most one Button. Must exist for every list; 1.0 shipped no empty states and the moderation console looked broken before the first photo.       |
| `Badge`          | Photo status, role, count.                                                                                     | Status is text plus an icon, never a coloured dot alone (§8).                                                                                                              |
| `Progress`       | Upload progress, event quota.                                                                                  | `role="progressbar"` with `aria-valuenow/min/max`, plus a text percentage in an `aria-live="polite"` region. Width comes from `--progress-value` (computed, so inline).    |
| `VisuallyHidden` | Text for assistive tech only.                                                                                  | Clip technique, not `display: none`; stays focusable when it wraps a skip link.                                                                                            |
| `Stack`          | Vertical/horizontal rhythm with `gap`.                                                                         | Renders a plain element with no ARIA. Exists so no component hand-writes margins.                                                                                          |
| `Grid`           | Responsive tile grids (§6).                                                                                    | `role="list"` / `role="listitem"` when the tiles are a collection, so counts are announced.                                                                                |

Not in the catalogue, and not to be invented locally: drawers, carousels, accordions,
and tooltips on the guest surface (there is no hover on a phone).

---

## 6. Layout

| Surface | Container                                    | Padding                                         | Notes                                                                                                   |
| ------- | -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Guest   | `max-width: var(--container-guest)`, centred | `var(--space-4)` inline, `var(--space-6)` block | Single column, primary action in the bottom 40%. Use `100dvh`, not `100vh`, or the iOS toolbar eats it. |
| Host    | `max-width: var(--container-host)`, centred  | `var(--space-5)`                                | Sticky toolbar on `--surface-raised`; content scrolls under it.                                         |
| Room    | None. Full viewport on `--surface-base`.     | `var(--wall-safe)`                              | See below.                                                                                              |

**Projector safe area.** Consumer projectors overscan. Every meaningful pixel —
captions, event name, QR, progress — sits inside the 4% inset (`padding: var(--wall-safe)`
on `.wall`); only the photo and its letterbox may reach the physical edge.

```css
/* moderation console (host): fixed-ratio tiles, so the grid does not
   reflow as photos of different aspect ratios stream in over SSE */
.moderationGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: var(--space-4);
}
.moderationTile {
  aspect-ratio: 4 / 3;
} /* thumbnail is object-fit: cover here */
```

**Mosaic wall** (room): a fixed 12-column grid with a `--tile-span` per cell, so the
layout is deterministic and a late arrival never reshuffles the wall. It is the one
layout allowed to crop (§9).

---

## 7. Motion

| What                             | Token                                                  | Property                                |
| -------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| Press / focus feedback           | `--duration-fast`, `--ease-out`                        | `opacity`, `transform: scale()`         |
| Dialog, Toast, tile state change | `--duration-base`, `--ease-out`                        | `opacity`, `transform: translateY()`    |
| Queue arrival, failed upload     | `--duration-base`, `--ease-out`                        | `opacity`, `translateY`, `border-color` |
| Wall crossfade                   | `--duration-slow`, `--ease-in-out`                     | `opacity` only                          |
| Ken Burns                        | `--wall-kenburns-duration` (computed), `--ease-linear` | `transform: scale()` + `translate()`    |

### The property budget, in three tiers rather than one rule

This section said "animate `opacity` and `transform` only" and the design system's own
`Button` has transitioned `background-color` since 2.0. One of those was wrong, and it was
the sentence: the reason given for the rule is layout, and a colour is not a layout. The
rule as it actually holds, and as `motion.budget.test.ts` now enforces:

| Tier           | Properties                                                          | Where it may be spent                                                                                                                  |
| -------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Compositor** | `opacity`, `transform`                                              | Anywhere, including the wall. The frame is the GPU's, no layout and no paint.                                                          |
| **Paint**      | `color`, `background-color`, `border-color`, `box-shadow`           | A state change a reader has to notice, at `--duration-fast` or `--duration-base`. **Never on the wall**, which repaints a full screen. |
| **Layout**     | `width`, `height`, `inline-size`, `inset-*`, `margin`, `padding`, … | Nowhere. The projector runs eight hours on whatever the venue owns, and a relayout every frame is a stutter the whole room sees.       |

`backdrop-filter` is in none of the three and is its own case: §13's material never
transitions, never animates and never spends `will-change`, **and neither may anything
wearing it** — a blur that moves is a blur recomputed every frame.

Rules:

- **The layout tier is empty and the test says so**, across every stylesheet the app
  ships, in `transition` shorthands and in `@keyframes` bodies alike.
- Decode and preload the next slide before the crossfade starts, or the fade shows a
  blank frame.
- Nothing loops on the wall except Ken Burns — no confetti, no pulsing "live" dot.
- While an upload is in flight, `Progress` is the only moving thing on the phone.
- `will-change` is spent on the wall's own layers and nowhere else. It pins a compositing
  layer for the lifetime of an element, not for the length of an animation.

### What moves, and what deliberately does not

Roadmap 11.2. "Each of those is a moment where motion carries meaning — the state changed,
and here is where it came from — and everything else is where motion is noise." The second
list is the longer one, and it is the one worth keeping written down.

| Moment                                  | What happens                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A guest presses a button                | `transform: scale(0.98)` at `--duration-fast`, already there since 2.0. A tap with no acknowledgement on slow Wi-Fi gets tapped again. |
| A photo arrives on the moderation queue | The one tile that is new fades and rises `--space-2` at `--duration-base`. Never the list, never a refetch.                            |
| An upload fails                         | The row's border goes to `--danger` over `--duration-base`, and the sentence that says why rises into place as it mounts.              |
| The wall changes slide                  | The crossfade it already had. Nothing was added.                                                                                       |

And what was left still, each for a reason that is not taste:

- **The guest's own uploads list.** It is what scrolls _under_ the upload composer, and the
  composer is a glass pane (§13): a thumbnail travelling behind it is a backdrop re-filtered
  every frame, on a phone that is mid-encode with a request open on a venue's Wi-Fi. The
  moderation queue gets the same motion because the machine is a laptop and the cost is one
  tile per photo; the phone does not, and that asymmetry is roadmap 11.3's two machines
  rather than an inconsistency.
- **The wall, anywhere at all.** It is already scaling, decoding a clip and crossfading, and
  every wall animation there is is timed from the slideshow's own interval. There is nothing
  a slide change could say that the crossfade does not.
- **Decided tiles leaving the queue.** An exit animation means holding a removed element on
  screen, and the queue is the one list where what is on screen has to be what the server
  agreed to.
- **The undo window.** A bar draining over nine seconds would be a second moving thing on a
  screen whose job at 23:00 is to be read, and the expiry is not a decision the host makes.
- **The live-stream indicator.** A pulsing dot is on §1's forbidden list, and the `Badge`
  already carries the word.
- **Lists in general, on any render.** A moderator working a queue is reading, not admiring.

`prefers-reduced-motion` is answered per animation, out of a closed set of three answers,
and `motion.budget.test.ts` fails on an animation that gives none: declared inside
`@media (prefers-reduced-motion: no-preference)` so the rule does not exist; declined in
JavaScript by the component (`usePrefersReducedMotion`, the wall); or replaced by the file's
own `reduce` branch (`Spinner`, which cannot simply stop moving).

**Ken Burns duration is derived, never authored.** 1.0 shipped
`animation: kenburns 20s infinite alternate linear` in `public/app.css` against a 10 s
slide interval, so every image visibly snapped back mid-slide. In 2.0 the duration is
computed in `src/domain/slideshow/` from the event's slide interval minus the
crossfade, and reaches CSS as a runtime custom property:

```tsx
// computed value -> the one legitimate use of an inline style
<div
  className={styles.slide}
  style={{ '--wall-kenburns-duration': `${durationMs}ms` }}
/>
// Slide.module.css:
// .slide { animation: ken-burns var(--wall-kenburns-duration) var(--ease-linear) both; }
```

A literal duration on a wall animation is a bug, not a style choice.

**`prefers-reduced-motion` is a health requirement, not a preference.** Vestibular
disorders and photosensitivity are real and a projected full-screen zoom is the worst
case, so under the query animation is removed, not shortened:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

Slides cut instead of crossfading and Ken Burns does not run, but the slideshow still
advances — content never depends on motion. This is the only permitted `!important`.

---

## 8. Accessibility contract

| Requirement                     | Concretely                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Touch targets                   | ≥ `var(--touch-min)` (44 px) for every interactive element on a guest surface, including the delete `IconButton` on a thumbnail. 1.0's `.delete-icon` was 28 px.                                                                                                                                                                         |
| Focus                           | `:focus-visible` ring from `--focus-ring` with `--focus-offset`, on every focusable element. `outline: none` without a replacement ring fails review.                                                                                                                                                                                    |
| Semantics                       | Semantic element first. 1.0's moderation tile was a `<div role="button" tabIndex={0}>` with hand-rolled `Enter`/`Space` handling and a nested delete `<button>` — nested interactives, a fake button, and `stopPropagation` holding it together. 2.0: a `<button>` for the status toggle, a sibling `IconButton` for delete, no nesting. |
| Images                          | Every `<img>` has meaningful `alt` or `alt=""` when decorative. A guest photo's alt is its caption and author; fallback `Photo envoyée par Léa`. 1.0 used the filename, which reads aloud as `IMG_4821.jpg`.                                                                                                                             |
| Live regions                    | Upload progress, queue counts and quota use `aria-live="polite"`; failures use `role="alert"`. One region per concern, mounted once — never one live region per photo.                                                                                                                                                                   |
| Colour is never the sole signal | The moderation tile's green/red border is paired with an icon and a word (`Publiée` / `Refusée`) in a `Badge`, so a red-green colourblind host can still work under stage lighting.                                                                                                                                                      |
| Contrast targets                | `--text-primary` on any surface ≥ 12:1; `--text-secondary` ≥ 7:1; `--text-muted` ≥ 4.5:1 and only for non-essential text at `--text-sm`+; `--accent-contrast` on `--accent` ≥ 7:1; anything on the wall ≥ 7:1 regardless of size; wall captions always sit on `--surface-scrim`, never directly on the photo.                            |
| Keyboard                        | Full journey reachable by `Tab`; skip link to main content; `Escape` closes every Dialog; moderation supports arrow-key navigation between tiles plus single-key approve/reject.                                                                                                                                                         |
| Language                        | `<html lang="fr">`. 1.0 shipped `lang="en"` with a French UI, so screen readers read French copy with an English voice.                                                                                                                                                                                                                  |

Verification: `web/src/design-system/tokens.contrast.test.ts` (ring 5) parses `oklch`
values straight out of `tokens.css`, converts through Oklab to linear sRGB, and fails
below the targets above; `tests/e2e/a11y/accessibility.spec.ts` runs an axe pass per
surface (ring 6).

Writing it immediately found three violations, which is the argument for having it:
`--text-muted` measured 4.27:1 on `--surface-overlay` against its own 4.5 target, and
`--border-strong` measured 2.5:1 on `--surface-base` — below WCAG 1.4.11's 3:1 floor for
a UI component's boundary, which matters because an input at rest _is_ its border.
`--text-muted` moved to 64% and `--border-strong` to 54%.

The third is recorded rather than fixed: `--accent-contrast` reaches only 5.16:1 on
`--accent-strong`, the hover state, against 7:1 at rest. It is not fixable by darkening
the foreground — `--accent-strong` sits at 64% lightness, so even pure black on it
measures 5.74:1 — so the test holds that pair to AA's 4.5 and closing the gap would mean
restyling the hover colour itself.

**Every ratio above compares two _declared_ colours, and that is a blind spot with a name.**
A translucent ground renders as neither of them: it renders as a composite against
whatever is behind it. The file says so about `opacity` on a caption and declines to model
it; §13's material cannot decline, so `tokens.contrast.test.ts` grew a second kind of
arithmetic — encode to sRGB, blend at the declared alpha, decode — because alpha
compositing happens in gamma-encoded sRGB and measuring the blend in Oklab flatters it by
a wide margin.

Pointing that at the palette found a fourth violation, in a token that predates the
material by two releases. **`--surface-scrim` does not deliver what this table promises.**
Over a bright photograph — a white dress in full sun, which is what a 55% black scrim is
_for_ — `--text-primary` on it measures **4.36:1** and `--text-secondary` **2.38:1**,
against "anything on the wall ≥ 7:1 regardless of size". Every wall caption sits on it. It
is recorded rather than fixed because raising it changes what the projector renders and the
committed baselines in `tests/e2e/visual/` exist so that cannot happen by accident: it is a
re-baseline with a human looking at every image, and it belongs in the branch that does
that rather than in the one that defined the material.

---

## 9. Wall layouts

Chosen at the screen, not on the event — there is no per-event layout setting. The
projector's URL selects one (`/e/:slug/display?layout=mosaic`, for a kiosk nobody will
touch) and the `L` key cycles from wherever that left it; absent both, the wall starts on
the domain's default. Playlist and layout rules are pure code in
`src/domain/slideshow/`; the renderer is one component per layout under
`web/src/features/wall/components/`.

| Layout                             | Crop behaviour                                                                                                                                                                               | Caption treatment                                                                                                                                                                                                                              | Choose it when                                                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fullscreen Ken Burns** (default) | `object-fit: contain` on `--surface-base`. Never crops. Slow scale + pan derived from the slide interval.                                                                                    | Bottom-left, inside `--wall-safe`, `--text-xl` on `--surface-scrim`, author name at `--text-lg` in `--text-secondary`. Hidden when there is no caption.                                                                                        | One screen, seated audience, photos arriving steadily. The safe default: it respects every aspect ratio, portrait phone shots included.                                   |
| **Mosaic**                         | `object-fit: cover` — cropping is accepted, because tiles must tessellate. Faces are not detected; keep tile aspect ratios near 4:3 and 1:1 to limit damage.                                 | Caption on hover is useless here (no pointer): show author only, `--text-lg`, in-tile bottom strip on `--surface-scrim`.                                                                                                                       | A busy cocktail hour with a high arrival rate — many photos visible at once, each one on screen longer than a single slide would allow.                                   |
| **Polaroid pile**                  | `cover` inside a fixed 4:5 frame with a `var(--space-3)` white mat and `--shadow-lg`; new photos land with a small rotation (± 4°, deterministic from the photo id so two projectors agree). | Caption inside the bottom mat, `--text-xl` in `--text-print`, credit in `--text-print-secondary`, truncated to two lines. The one caption on paper rather than on a scrim — and never diluted with `opacity`, which no contrast ratio can see. | Weddings and small parties where the physical-photo metaphor lands, and where arrival rate is low enough that a landing animation reads as an event rather than as noise. |
| **Filmstrip**                      | `cover` inside a 4:3 frame. Five frames across a band, plus one waiting off the right edge; the track travels exactly one frame per slide, timed from the slide interval.                    | None. A drifting caption is unreadable, and text that moves is the thing this layout is trying not to be.                                                                                                                                      | A cocktail hour where nobody is watching continuously — there is no moment to miss, because the strip is always mid-move.                                                 |
| **Collage**                        | `cover` on a fixed 4x3 of equal cells, filled in DOM order. Starts on one photo and gains a cell per slide, to a ceiling of twelve; it then recycles a cell in turn.                         | None: at twelve cells a caption is a smudge.                                                                                                                                                                                                   | The start of an evening, or a room that will watch the wall compose itself. It is the one layout that deliberately shows less than it could at first.                     |
| **Split**                          | Two panes, each `contain`. Panes advance alternately so one half is always stable, and the left one reaches half a playlist back for an older upload.                                        | Caption under each pane, `--text-xl`, one line, ellipsis.                                                                                                                                                                                      | Ultra-wide screens (21:9, or two projectors edge-blended) where a single `contain` photo would leave two enormous black bars.                                             |

All six: the playlist window is capped and elements are recycled so an 8-hour run does
not grow — every layout's element count is bounded by its `slotCount` in
`src/domain/slideshow/wallLayout.ts`, mirrored as a constant in `WallLayouts.tsx` because
the import boundary forbids joining them — and position is derived from the playlist,
never from `sessionStorage` (1.0 stored it per browser, so two projectors disagreed).
Position, not composition: the collage's _fill_ is per-screen and resets on a reload, and
no wall carries a cursor on the wire, so two projectors are only in step when they are on
the same index.

Three layouts animate beyond the crossfade, and they are not handled the same way (§7).
The polaroid's landing and the filmstrip's drift are **declined in JavaScript**: the drift
must be, because its end frame is `translateX(-20%)` and the `base.css` collapse would
strand the band there, and the landing is because relying on a global `!important`
collapse is relying on a keyframe's end frame happening to be the resting state — true
today, one edit from false. The collage's cell arrival is the third, and it ends at the
cell's resting state, so the collapse lands exactly where the animation would have.

The drift is the only animation on the wall that runs for a whole slide, so it is timed
from the slideshow's own interval — the same rule Ken Burns follows, for the same reason
— and that interval is `0` whenever the wall is not advancing, paused included, so a held
wall stops moving rather than finishing its travel.

The layout is named on the wall element as `data-wall-layout`, which is how the visual
suite proves it photographed the layout it asked for. A slot count cannot: a filmstrip
and a mosaic can both be holding six photos.

### The reserved corner

The join card sits bottom-right and is the wall's **default** state — a host has to
dismiss it. Every layout that centres a caption in the bottom band therefore printed the
guest's own words underneath it. Measured on a 1920×1080 projector: the polaroid's third
caption lost 362px of its box and the split's right caption 42px, both cut mid-word.

The card yields, not the caption. A caption is the guest's words under the guest's photo;
the card is chrome, and §1 says chrome recedes. So the wall **declares** the corner and
the layouts lay out inside what is left:

- `--wall-join-card` is the card's declared width. A content-sized card has no footprint
  anything can reserve, which is why it is a token rather than whatever the QR measures.
- `.wall` publishes `--wall-chrome-inline-end`: `0px` normally, and the card plus a
  `--space-6` gutter while `data-wall-chrome="corner"` is set. The gutter is `--space-6`
  and not `--space-5` because a polaroid is rotated and `overflow: hidden` clips to the
  padding box, so a tilted print renders past where the reservation puts it.
- `polaroid` and `split` add it to their `padding-inline-end`. Nothing is given up
  permanently: dismissing the card removes the attribute and the width comes straight
  back, which is one Escape away.

Layouts whose text cannot reach the corner ignore all of this. The mosaic's in-tile credit
is left-aligned at the start of its tile — measured at x 985 against a card at x 1448 — so
only the empty end of its scrim passes behind the card, exactly as the photo under it
already does. The filmstrip and the collage show no captions at all.

---

## 10. Copy and tone

- **French, with correct accents.** 1.0 shipped `L'authentification a echoue` and
  `vos photos apparaitront bientot`; missing accents are a defect. Strings live in
  `web/src/lib/i18n/` — no French literal in a component.
- **Vouvoiement everywhere, admin included.** Decided once: wedding guests span every
  age, and mixing registers between screens reads as sloppy. Do not reopen per feature.
- **Sentence case**, and at most one exclamation mark per surface — reserved for the
  confirmation a guest sees once.
- **An error says what happened, then what to do next**, and never shows a status code.
- Narrow no-break space before `? ! : ;` and inside `« »`; `’` not `'`.

| Context                | Bad                                                                                                           | Good                                                                                                                         | Why                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Login failure          | `L'authentification a echoue. Veuillez verifier vos identifiants.` (1.0)                                      | `Identifiants incorrects. Vérifiez l’adresse e-mail et le mot de passe.`                                                     | Accents; names the two fields to check instead of "your credentials".                                     |
| Upload failure         | `L'envoi a échoué. Veuillez réessayer.` (1.0)                                                                 | `Photo non envoyée : la connexion s’est interrompue. Touchez « Réessayer », la photo est conservée.`                         | Says why, says the next action, and removes the fear of having lost the photo.                            |
| Upload confirmation    | `Merci pour vos photos !` + `L'envoi a bien fonctionne, vos photos apparaitront bientot dans la salle.` (1.0) | `Merci, vos photos sont envoyées.` + `Elles passeront à l’écran après validation par les organisateurs.`                     | Sets the moderation expectation, which 1.0 hid; accents fixed.                                            |
| QR / join screen       | `Scannez ce QR Code pour envoyer vos photos !` (1.0)                                                          | `Scannez pour envoyer vos photos.`                                                                                           | Shorter at 5 m; no exclamation inflation; "QR Code" is redundant next to a QR code.                       |
| Quota reached          | `Erreur 413 : Payload Too Large`                                                                              | `L’espace photos de cet événement est plein. Prévenez les organisateurs.`                                                    | No status code; gives the guest an action they can actually take.                                         |
| Wrong file type        | `Type de fichier invalide`                                                                                    | `Ce fichier n’est pas une photo. Choisissez un JPEG, un PNG ou un HEIC.`                                                     | Lists what is accepted, which is the only useful part.                                                    |
| Delete confirmation    | `window.confirm('Supprimer définitivement photo-123.jpg ?')` (1.0)                                            | Dialog: `Supprimer cette photo ?` / `Elle disparaîtra de l’écran et ne pourra pas être récupérée.` / `Supprimer` · `Annuler` | A filename means nothing to a host; states the consequence; a real Dialog is styleable and focus-managed. |
| Moderation empty state | `Aucune donnée`                                                                                               | `Aucune photo en attente. Les nouvelles photos arriveront ici automatiquement.`                                              | Explains that the screen is working and that no refresh is needed.                                        |
| Wall, no photos yet    | _(blank black screen — 1.0)_                                                                                  | `En attente des premières photos.` + join code at `--text-display`                                                           | The wall doubles as the invitation while it is empty.                                                     |

---

## 11. What not to do

| Do not                                                                             | Because                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add Bootstrap or any CSS framework                                                 | 1.0 pulled `bootstrap@5.3.3` from jsDelivr in `index.html` and then fought it with 186 lines of `!important` overrides in `public/app.css`. The primitives in §5 are smaller than the overrides were.            |
| Load anything from a CDN — `<script>`, `<link>`, a font, an icon set               | The `helmet` CSP forbids it and a venue's Wi-Fi will drop it mid-event. Bundle it.                                                                                                                               |
| Write utility-class soup (`className="d-flex flex-wrap gap-2 mb-3 p-3 rounded-3"`) | Real 1.0 line. Layout intent becomes unreadable and untestable; use `Stack`, `Grid`, and a CSS Module.                                                                                                           |
| Use `style={{ … }}` for a static value                                             | Real 1.0 line: `style={{ background: 'rgba(0,0,0,0.2)' }}`. Inline style is only for a computed value — `--progress-value`, `--wall-kenburns-duration`, a grid position, a transform.                            |
| Add a fourth bespoke button                                                        | `Button` has four variants and three sizes. If your action does not fit, the action is wrong or the variant belongs in `Button`.                                                                                 |
| Add a shade that duplicates an existing role                                       | `#cbd5e1`, `#e2e8f0`, `#94a3b8` and `#f8fafc` all coexisted in 1.0 as "light text". Three text tokens is the whole budget.                                                                                       |
| Ship a screen without empty, loading and error states                              | They are the states people actually hit at an event, and 1.0 shipped none of them.                                                                                                                               |
| Encode meaning in colour alone, or add a second accent hue                         | See §8; and one accent, used sparingly, is what keeps the photo the hero.                                                                                                                                        |
| Write `backdrop-filter`, a blur radius or a pane tint in a component               | §13. Glass is a material: one declaration in `glass.module.css`, one set of tokens, and `composes` everywhere else. A second blur radius is the drift the material exists to prevent, and the build fails on it. |

---

## 12. Per-event theming

Roadmap 2.2. A host gives one event a look: an **accent hue**, a **font pairing** and a
**frame style**. A wedding in rose and a corporate launch in a company blue should not
look like the same product, and before this they did.

### The one degree of freedom

An event moves **`--accent-hue` and nothing else.** Lightness and chroma stay where §2
put them, so the palette a hue produces is a function — which is what makes "can the room
read this" answerable before it is stored, and what makes it impossible for a host to
choose an unreadable lightness. Nothing else in the product gains a knob: there is no
per-event surface colour, no per-event spacing, no second accent.

That is also why no colour crosses the wire. An angle does, and `tokens.css` turns it into
three colours, so §2's rule — one file holds every raw value — survives the feature that
was most likely to break it.

### Where the rule lives

**In the domain, not here.** `src/domain/events/eventTheme.ts` decides which hues are
allowed and returns a `DomainError` for the ones that are not; a stylesheet cannot refuse
anything, it can only render badly. The rule is three checks:

| Check                                              | Bar   | Why                                                                       |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------- |
| `--accent-contrast` on `--accent`                  | 7:1   | §8's target for the label on every primary button                         |
| `--accent-contrast` on `--accent-strong`           | 4.5:1 | §8's recorded concession: 7:1 is unreachable at 64% lightness, at any hue |
| Distance from `--success`, `--danger`, `--warning` | 30°   | Otherwise "press this" and "that went wrong" are one signal at ten metres |

A refusal names what was broken and by how much, and the host is told rather than
silently moved to a colour they did not pick — a host who sees an unasked-for colour
cannot tell whether the form saved.

Two things are checked here rather than there, because they are properties of the
stylesheet: `tokens.contrast.test.ts` sweeps the whole hue circle against the real
declarations, and `eventThemeContract.test.ts` fails if the lightness and chroma the rule
computes with ever stop matching the ones `tokens.css` declares.

### Where it is applied

On the **surface element**, as props rendered with the content they theme — never on
`:root` from an effect. Two reasons, both about a defect somebody notices:

- The host's console is deliberately **not** themed. It is one operator's tool across many
  events, and `--success`/`--danger` there are a working vocabulary rather than
  decoration. A `:root` override cannot say "these surfaces and not that one".
- A `:root` write lands _after_ React has produced a frame, so the wall would paint the
  product's violet and repaint in the host's rose on every reload, for eight hours, in
  front of two hundred people. As props there is no frame in between. Before the wall's
  first response there is nothing accent-coloured on screen either — the loading state is
  a `--text-primary` spinner on `--surface-base` — so the projector has nothing to blink.
  (The one exception is the paused glyph, which needs somebody standing at the projector
  pressing Space in the two hundred milliseconds before the playlist lands.)

`--accent` is declared for `:root` **and** for `[data-event-accent]` in one rule, and that
is a correctness fix rather than a style: a custom property that references another is
resolved on the element it is declared on, and descendants inherit the substituted result.
Declared only on `:root`, `--accent` would keep hue 305 however far down the tree
`--accent-hue` moved. This was written that way first and a Chromium end-to-end check
caught it.

### What each surface takes

| Surface | Accent | Font pairing | Frame style |
| ------- | ------ | ------------ | ----------- |
| Room    | yes    | yes          | yes         |
| Guest   | yes    | no           | no          |
| Host    | no     | no           | no          |

**The pairing costs zero bytes, and that is the decision rather than a happy accident.**
There is no CDN here (§11) and the CSP forbids one, so a downloaded face means a bundled
one. §4 is the number: nothing is bundled today, a latin + latin-ext variable `woff2` runs
about 100 KB, and a _pairing_ is two of them — roughly 200 KB against an initial JavaScript
bundle of 245 KB, paid by a guest on a saturated access point for a display face their
screen is not large enough to show off.

So both pairings are built from faces the device already has: the system UI stack for body
text, and a system serif for display type. `ui-serif` first, then Georgia and the faces a
desktop actually has. What that buys is real on a projector at `--text-display` and
nothing at all on a phone, which is exactly why the pairing is applied to the wall and not
to the guest. What it costs is that two machines may render the same wedding in two
different serifs — accepted, because the alternative is 200 KB on the one surface this
product cannot afford to slow down.

Two pairings and not four, for the same reason: a third would have to be a bundled family
or a stack that silently resolves to the sans on half the machines it meets.

The frame style moves `--wall-frame-radius`, consumed by the three layouts that draw a
frame: the mosaic's tile, the filmstrip's frame and the collage's cell. The spotlight and
the split `contain` a photo against black and draw none. The polaroid is untouched on
purpose — that layout _is_ a frame style, and its mat is a material (§2) rather than a
corner.

### The default

An event that chose nothing renders **the DOM that shipped**: no attribute, no inline
style, no theme block matching. Not "the default values on the element" — nothing. That is
what the nine committed wall baselines in `tests/e2e/visual/` photograph, and why they did
not move when this landed.

---

## 13. The glass material

Roadmap 11.1. A translucent pane that picks up the photograph behind it, and the reason
this section exists rather than a line in §2: glass is a **material**, not an effect. Six
parts make a pane read as a physical sheet — a blur radius, a saturation lift, a tint, a
hairline border, an inner highlight and a shadow — and a pane whose blur differs by four
pixels from the one beside it reads as a mistake even to somebody who cannot say why. The
repository already forbids a raw colour outside `tokens.css`; this is that rule applied to
a compound.

### Where it lives, mechanically

| File                             | Allowed to                                                                |
| -------------------------------- | ------------------------------------------------------------------------- |
| `design-system/tokens.css`       | **declare** `--glass-*`, and nothing else may                             |
| `design-system/glass.module.css` | **read** them — the one `backdrop-filter` declaration in the source       |
| anything else                    | ask for the material by name: `composes: sheet from '…/glass.module.css'` |

`glass.material.test.ts` sweeps every stylesheet the app ships and fails the build on any
of the three. That is what makes "the budget can be enforced in one place" true rather
than aspirational, and it is the same kind of guard as the import boundaries in
[CLAUDE.md](../CLAUDE.md) §2: mechanical, not a review convention. "In the source" is
exact: CSS Modules copies a composed class into every chunk that uses it, so the built
bundle carries `.sheet` once per chunk. That is a bundler detail, not a second definition.

The class is `sheet` and not `pane` because the wall already has two `.pane` classes of
its own, and the wall is the surface this material must never reach.

The material owns the four declarations its six parts need — the tint, the filter, the
hairline and a `box-shadow` carrying the inner highlight plus the elevation — and no
layout at all. **A surface wearing it may not redeclare any of the four, and may not
animate**, both asserted: the emission order of a composed class is the bundler's to
choose, so a consumer that sets `background` can win on one page and lose on another; and
an element carrying `backdrop-filter` that animates `opacity` or `transform` is a backdrop
re-filtered every frame, which is the one place §7's "animate `opacity` and `transform`
only" does not license.

### The tint floor, which is where the interesting number is

A pane sits on top of whatever a guest uploaded. The brightest thing that can be behind
it is **pure white** — a white dress in full sun, and also the ceiling of the sRGB gamut,
so a pane that holds its contrast over white holds it over every photograph, every accent
a host can choose (§12) and every combination of the two. Blur does not help: a blurred
white field is still white. Saturation does not help. Only the tint's alpha does, which is
why the roadmap calls it a floor.

That is one of two floors. The second is below; this one is what a pane needs when it
cannot know what is behind it.

`0.95` is derived, not chosen. It is the lowest alpha at which the material over white is
at least as good a ground as **`--surface-overlay`** — the darkest surface this design
system already lets text sit on — for all three text tokens at once:

| Ink                | on `--surface-overlay` today | on glass over pure white | §8 target |
| ------------------ | ---------------------------- | ------------------------ | --------- |
| `--text-primary`   | 14.27                        | **14.30**                | 12        |
| `--text-secondary` | 7.77                         | **7.79**                 | 7         |
| `--text-muted`     | 4.62                         | **4.64**                 | 4.5       |

At `0.94` all three fall below the right-hand column — `--text-muted` to 4.50, which
scrapes §8's bar while being a worse ground than `--surface-overlay`, and that is the
point: the bar in the middle column is the binding one. So the claim the material makes is
not "glass is usually readable"; it is **over any photograph, glass is a better ground
than the darkest panel this product already permits text on.** Every number above is measured by
`tokens.contrast.test.ts`, which also sweeps the accent-coloured link, the focus ring at
its painted alpha, the three status glyphs, and all 360 hues of glass over a themed accent.

**The cost is stated rather than hidden: that floor leaves 5% of the backdrop showing.**
The material is a thick one. What reads as glass is the blur and the 180% saturation lift
applied to that 5% — over a photograph it tints the pane with the picture's own colours,
which is the effect §11 asks for — and the hairline, the inner highlight and the shadow.
Anything more transparent is a different product with a weaker accessibility contract, and
§1 says the photo is the hero and chrome recedes.

### The second floor: most of this product is not a photograph

Roadmap 11.2. Login, the dashboard, the create form, the settings page and the guest's join
screen never show a guest's upload, and holding them to a floor derived from a white dress
is answering a question they do not ask. Over our own ground the backdrop is a colour this
design system declares, so the worst case is **enumerable rather than unbounded** — and the
same derivation, run against it, gives a second number.

`--glass-tint-ground` is `0.92`, derived exactly as `0.95` was and against the same bar: the
lowest alpha at which the material is at least as good a ground as `--surface-overlay` for
all three inks at once, while keeping an accent link above 4.5:1, the focus ring above 3:1
and the status glyphs above 3:1, at every one of the 360 hues an event can carry.

**What it is derived against is the load-bearing choice: the brightest _field_ a stylesheet
paints, not the brightest token in the palette.** Contrast is a property of a ground and a
ground is an area. `--text-primary` is the lightest colour here, but as body text it paints
strokes over a small share of their line boxes and a 20 px blur of a paragraph is a haze
near the page's own ground. What fills an area is a surface or a filled control, and the
lightest filled control this product draws is a primary button — `--accent`, at whichever
hue renders lightest.

| Tier                  | Alpha | Derived against                | Backdrop showing |
| --------------------- | ----- | ------------------------------ | ---------------- |
| `--glass-tint-photo`  | 0.95  | pure white                     | 5%               |
| `--glass-tint-ground` | 0.92  | `--accent` at its lightest hue | 8%               |

**Three points of alpha is the measurement, and it is smaller than it sounds like it should
be.** The photograph was never what made this material opaque. `--text-muted` clears 4.62:1
on `--surface-overlay` against a 4.5 target, so the palette has about a tenth of a ratio
point of headroom before a translucent ground stops being one this design system would
accept, and removing the unknown backdrop spends nearly all of it. Anything markedly more
transparent than this needs an ink moved or the pane's own ink budget narrowed — a different
change, with a different argument, and one nobody has made.

### Which tier a surface is served, and why that is not a label

A pane may take the translucent floor only if nothing brighter than that floor's backdrop
can be painted underneath it. That is a claim about a whole page subtree, which is exactly
the kind of claim that is true when it is written and false two features later.

So the claim is made once, in `app/glassBackdrop.ts` — one row per address, beside the page
module it renders — and checked against the thing it is a claim about.
`glassBackdrop.test.ts` walks the **real import graph** from each page module and refuses a
`ground` claim whose subtree can reach an `<img>`, a `<video>`, or a background fill
brighter than the ceiling the floor was derived against. Marking the moderation queue
translucent fails the build, naming `ModerationCard.tsx`.

**"No guest photograph on this screen" was the obvious rule and it is not sufficient.** The
event page at `/admin/events/:slug` prints the join QR, whose plate is `--text-primary` — a
near-white field, because a code has to be dark-on-light to scan at all — and a contrast
ratio cannot tell that apart from a white dress in full sun. That address is on the strict
floor because the guard checks brightness rather than provenance, not because anybody
remembered it.

The tier reaches the DOM exactly where the budget already did: one attribute on the shell,
composed from two independent answers in `design-system/glass.ts` — what the material costs
here (the room cannot afford it) and what can be painted underneath it. The room's answer
wins outright, so no address can put a blur back on the projector. **The strict floor
spreads no attribute at all**, which is what keeps the default safe and leaves the DOM of
both panes that wear the material today exactly as it was.

One consequence of the fallbacks: the capability query and the preference query move
`--glass-tint-photo` and `--glass-tint-ground` rather than `--glass-tint`. A tier is a
declaration on a descendant of `:root`, and a descendant wins for its own subtree whatever
the specificity of the two selectors — so a `:root` block naming `--glass-tint` directly
would be discarded on every surface carrying a tier, and a guest who asked for more contrast
would have been handed the most translucent pane in the product.

### The fallback, which is not a degraded mode

`--glass-opaque` **is** `--surface-raised`. Not a colour of its own, not a fifth grey (§2
forbids one), not a look nobody has reviewed: the tint and the fallback are one colour at
two alphas, so a machine that cannot blur renders a surface this product ships on every
other screen. That is the whole of "a no-blur fallback that is not ugly".

### The budget: what is switched off first

Roadmap 11.3. Three conditions reach the one fallback, and each sets the same two
declarations:

| Condition                                                        | Why                                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@supports not ((backdrop-filter) or (-webkit-backdrop-filter))` | The capability. Both spellings, or several years of iPhones lose the blur on the surface most guests hold. |
| `prefers-reduced-transparency: reduce`, `prefers-contrast: more` | A person told the machine what this costs them. Same category as reduced motion (§7).                      |
| `[data-glass='opaque']`                                          | **The room.** Set by `AppShell` from the rule in `design-system/glass.ts`.                                 |

The room's reason is a mechanism, not a guess. `backdrop-filter` is cheap over still
content — the compositor blurs the backdrop once and keeps the layer — and expensive over
content that changes every frame, because then it blurs every frame at the pane's full
size. The guest's phone and the host's console show panes over content that is still
between interactions. The wall never is: it is crossfading, running Ken Burns, and since
roadmap 1.4 may be decoding a video clip under both, on a venue mini-PC, unattended, for
eight hours. **So the room takes the fallback and the guest keeps the blur**, and that is
decided here rather than discovered at a wedding.

The tier is an inherited custom property on the surface element, for the reasons §12 gives
for the event theme: properties inherit, so one attribute decides the material for
everything inside it in the same paint, no primitive learns that tiers exist, and there is
no second copy of the material to keep in step. A surface on the blur tier spreads **no
attribute at all**, so its DOM is what it was before the material existed.

### Where it is applied, and why only there

A material nobody can see is not reviewable; a material applied everywhere is not
reviewable either. The rule is **a sticky pane with the reader's own content moving
underneath it**, which in this product is two places:

| Surface                   | Audience | What is behind it                                  |
| ------------------------- | -------- | -------------------------------------------------- |
| The guest upload composer | guest    | the photographs they just sent, scrolling under it |
| The moderation toolbar    | host     | a hundred tiles scrolling under a sticky bar       |

Everything else keeps its opaque surface token. The list is asserted in
`glass.material.test.ts`, so a third surface is a deliberate edit to a test that says why
these two were chosen. "Moving underneath it" is the load-bearing half: a blur with
nothing moving behind it is an expensive way to draw a panel.

**Both of them are served the strict floor, and nothing wears the translucent one yet.**
That is the tier rule's own verdict rather than a shortfall: what moves under each of those
two panes is a guest's photographs. The rule above is what says so, and
`glassBackdrop.test.ts` asserts it — so the day a pane is added to an address that earns the
translucent floor, it gets it without anybody editing a value. Nothing was applied to
login, the dashboard or the join screen to give the second tier a customer: the rule for
where the material goes is unchanged, and a blur over a flat token ground is invisible while
still costing a compositing layer.

**`Dialog` was the obvious third and it was measured out**, which is worth recording
because it is the seductive one. `backdrop-filter` does work on an element in the top
layer. But `.dialog::backdrop` is `--surface-scrim` at 55%, so of the page beneath only
45% survives it, and of that only the tint's 5% reaches the eye: about 2% of the content,
which renders indistinguishably from the opaque fallback. The panel also animates on open
(§7), so it would have been a backdrop re-filtered every frame for 240 ms on a phone,
possibly mid-upload. A glass dialog wants the blur on the _backdrop_ rather than on the
panel, and `::backdrop` cannot carry the material: `composes` does not apply to a
pseudo-element, and `::backdrop` only began inheriting custom properties from its
originating element in 2024 — on a browser that has not, `var(--glass-tint)` would resolve
to nothing and the scrim would vanish. That is a change with its own argument, not a
by-product of this one.

**`Toast` is the other candidate and it is out for a structural reason somebody should fix
first.** `ToastProvider` renders its region as a _sibling_ of `AppShell` — see
`app/router.tsx`, where the placement is itself a correctness fix about which language a
toast speaks — so the region is outside the element that carries `data-glass`. A glass
toast would therefore keep its blur on the wall, which is the one surface the budget says
must not have it. The material is not applied where the budget cannot reach it. Whoever
wants a glass toast moves the tier, or the region, first.

### What is measured and what is asserted

Stated plainly, because the difference matters:

- **Measured, and failing in CI if it moves:** every contrast ratio above, for both tints,
  over white and over 360 accents, in `tokens.contrast.test.ts` — including that each
  declared alpha is the _lowest_ that holds, so a floor that stopped being derived fails;
  the one-declaration rule and the two rules a wearer must obey, in
  `glass.material.test.ts`; which addresses may claim the translucent floor, walked over the
  real import graph in `app/glassBackdrop.test.ts`; and in
  `tests/e2e/journeys/glass-budget.spec.ts`, read in a real browser on the pane itself
  rather than on an ancestor, the room resolving `none`, the guest resolving a real blur, a
  guest who asked for more contrast getting the opaque pane, and the two tiers resolving to
  different tints one screen apart in the same journey.
- **Reasoned, not measured:** the frame-rate claim. No test in this repository runs on a
  venue mini-PC driving a projector, and a frame-rate assertion taken on CI hardware would
  be a number about the CI runner. What the budget rests on is the mechanism — a blur over
  moving content is recomputed every frame — plus the decision to give the wall the
  fallback unconditionally, which means the wall's cost is **zero** and there is nothing
  to measure there until a later branch puts a glass pane on it. The same honesty applies to
  the one place roadmap 11.2's motion meets this material: a tile arriving under the
  moderation toolbar re-filters that pane's backdrop for `--duration-base`. That is a
  mechanism and a bound — one tile per photograph, on a laptop — not a measurement.

**The human check, precisely.** Before any branch puts glass on the wall: on the venue
mini-PC, open `/e/:slug/display?layout=spotlight` on an event whose playlist contains at
least one video clip, in Chromium, with DevTools → Rendering → **Frame Rendering Stats**
showing. Let it run through ten slide changes including at least two that cross into or out
of the clip. The wall holds if the dropped-frame count stays at zero through every
crossfade; a single crossfade that drops frames is the budget saying no. Run it twice: once
with the wall as shipped, once with `data-glass` removed from the shell in DevTools, and
compare — the second run is what says whether glass was the cause.
