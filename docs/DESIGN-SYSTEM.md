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

  /* ---- Accent. One hue. Reserved for the primary action and nothing else. ---- */
  --accent: oklch(72% 0.17 305);
  --accent-strong: oklch(64% 0.19 305); /* hover / pressed */
  --accent-contrast: oklch(18% 0.02 305); /* text on top of --accent */
  /* ---- Semantic ---- */
  --success: oklch(76% 0.16 155);
  --danger: oklch(68% 0.19 22);
  --warning: oklch(82% 0.15 85);
  /* ---- Focus ---- */
  --focus-ring: 0 0 0 3px oklch(72% 0.17 305 / 0.65);
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
  --radius-sm: 0.375rem;
  --radius-md: 0.75rem;
  --radius-lg: 1.25rem;
  --radius-full: 999px;

  /* ---- Shadows. Elevation is the only thing shadows encode. ---- */
  --shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.3);
  --shadow-md: 0 8px 24px -8px oklch(0% 0 0 / 0.45);
  --shadow-lg: 0 24px 60px -12px oklch(0% 0 0 / 0.55);

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
  filmstrip's travel, timed from the slide interval) and `--wall-tilt` (a polaroid's
  angle, derived from the photo id so two projectors agree). Everything else is static
  CSS.

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

**Face: Inter Variable, self-hosted.** SIL Open Font License, one variable `woff2`,
readable at 14 px on a phone and at 8 m on a wall. No CDN — the `helmet` CSP forbids a
remote `<link>`, and a venue's Wi-Fi will drop it anyway.

```css
/* web/src/design-system/fonts.css — file in web/src/design-system/fonts/ */
@font-face {
  font-family: 'InterVariable';
  src: url('./fonts/inter-latin-ext.woff2') format('woff2-variations');
  font-weight: 400 700;
  font-display: swap; /* the fallback stack renders first; nothing waits on a font */
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+2000-206F, U+20AC;
}
```

- Subset **latin + latin-ext**: French needs `é è ê à â ç î ï ô ù û œ` and the narrow
  no-break space; a `latin`-only subset drops `œ` and falls back mid-word.
- The fallback stack is load-bearing: `font-display: swap` means somebody reads
  `system-ui` / `Segoe UI` first.
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

| What                             | Token                                                  | Property                             |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------ |
| Press / focus feedback           | `--duration-fast`, `--ease-out`                        | `opacity`, `transform: scale()`      |
| Dialog, Toast, tile state change | `--duration-base`, `--ease-out`                        | `opacity`, `transform: translateY()` |
| Wall crossfade                   | `--duration-slow`, `--ease-in-out`                     | `opacity` only                       |
| Ken Burns                        | `--wall-kenburns-duration` (computed), `--ease-linear` | `transform: scale()` + `translate()` |

Rules:

- **Animate `opacity` and `transform` only.** Never `width`, `height`, `top`, `left`,
  `margin` or `background-position`: they force layout every frame, and the wall runs
  for eight hours on whatever hardware the venue owns.
- Decode and preload the next slide before the crossfade starts, or the fade shows a
  blank frame.
- Nothing loops on the wall except Ken Burns — no confetti, no pulsing "live" dot.
- While an upload is in flight, `Progress` is the only moving thing on the phone.

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

| Do not                                                                             | Because                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add Bootstrap or any CSS framework                                                 | 1.0 pulled `bootstrap@5.3.3` from jsDelivr in `index.html` and then fought it with 186 lines of `!important` overrides in `public/app.css`. The primitives in §5 are smaller than the overrides were. |
| Load anything from a CDN — `<script>`, `<link>`, a font, an icon set               | The `helmet` CSP forbids it and a venue's Wi-Fi will drop it mid-event. Bundle it.                                                                                                                    |
| Write utility-class soup (`className="d-flex flex-wrap gap-2 mb-3 p-3 rounded-3"`) | Real 1.0 line. Layout intent becomes unreadable and untestable; use `Stack`, `Grid`, and a CSS Module.                                                                                                |
| Use `style={{ … }}` for a static value                                             | Real 1.0 line: `style={{ background: 'rgba(0,0,0,0.2)' }}`. Inline style is only for a computed value — `--progress-value`, `--wall-kenburns-duration`, a grid position, a transform.                 |
| Add a fourth bespoke button                                                        | `Button` has four variants and three sizes. If your action does not fit, the action is wrong or the variant belongs in `Button`.                                                                      |
| Add a shade that duplicates an existing role                                       | `#cbd5e1`, `#e2e8f0`, `#94a3b8` and `#f8fafc` all coexisted in 1.0 as "light text". Three text tokens is the whole budget.                                                                            |
| Ship a screen without empty, loading and error states                              | They are the states people actually hit at an event, and 1.0 shipped none of them.                                                                                                                    |
| Encode meaning in colour alone, or add a second accent hue                         | See §8; and one accent, used sparingly, is what keeps the photo the hero.                                                                                                                             |
