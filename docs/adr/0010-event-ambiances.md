# ADR 0010 — Event ambiances, and the Chambre noire as the product's own look

## Status

Proposed, with a prototype on `feat/ambiances-proto`. The field, its storage, its wire shape, the
picker, the root palette and one festive ambiance (Guinguette) are built and tested, and so are the Guinguette's clothesline
layout and its visual baselines. **Not built**, and said so: the Chambre noire's contact sheet, the ornaments on the wall's join card, the marker strokes in the moderation console,
the derivation of the Guinguette's glass alphas (set conservatively above the root's for now), a
measurement of text over the photographed ground (the grade is chosen, not derived: a node test
sampling the WebP per band is the honest version), a contrast check of the kraft texture under its
label.

## Date

2026-10-28

## Context

The UI/UX review of 28 October (`eventslide-suivi/rapports/revue-ui-ux-2026-10-28.html`) found that
EventSlide has no identity of its own. Its palette was the default of a dark SaaS console: a slate
ground at hue 265, a lavender accent at 305, the system face, no wordmark. Nothing a guest saw could
tell them which product made the wall they were looking at, and nothing distinguished one evening from
another beyond one accent hue.

The event theme of roadmap 2.2 already lets a host move four things: an accent hue, a font pairing, a
frame style and a material. Each is a closed vocabulary or a single angle, chosen that way so that no
host can pick an unreadable screen. What a host cannot choose is a **world**: the surfaces, the inks,
the faces and the ornaments that together make a wedding look different from a village party. A fifth
independent knob per property (surface hue, ink warmth, heading face…) would put the legibility rule
back in the host's hands, which is what 2.2 refused to do.

Two looks came out of the review as the strongest: the **Chambre noire** (a photographer's darkroom:
velvet black, a safelight glow, paper as the only light thing, a photo that develops from its negative)
and the **Guinguette champêtre** (dinner under string lights in a garden at dusk: a photographed
ground, kraft, filament bulbs, linen gingham). Pierre asked whether several could be offered side by side.

## Decision

1. **An event's theme names an ambiance**: `ambiance: 'darkroom' | 'guinguette'`, beside the accent,
   the pairing, the frame and the material, in `src/domain/events/eventTheme.ts`. It is a closed
   vocabulary; adding an ambiance is a code change with its own review, never host input.
2. **An ambiance is a block in `tokens.css`**, selected by `[data-event-ambiance='…']` on the themed
   surface and by `:root:has(…)` for the page around it, so the body, the header and the ornaments
   follow in the same paint. A template preview in the console is excluded by its marker. The block
   restates every derived custom property (glass tints, opaque fallback, focus ring), because a
   property that references another is substituted where it is declared.
3. **The whole evening wears it, console included** (amended 28/10, Pierre's call: "tout,
   console comprise"). The guest's phone and the wall are themed surfaces; every other page that
   is about one event (the welcome after a scan, the host's event page, settings and both
   moderation consoles) carries an `AmbianceMarker`, and `:root:has()` dresses the page around
   it. The accent, the pairing and the frame still stay off the console, and the semantic colours
   are fixed in every ambiance, so the moderation queue keeps its working vocabulary. The
   dashboard, sign-in and accounts stay in the root look: they are about no single evening.
4. **The Chambre noire is the root**, i.e. the product's own look and the default ambiance, which
   emits no attribute. With no event accent, the primary action is the **paper**: a print-white
   button, the one light surface on a screen. An event that chose a hue still gets the 2.2 derivation
   on its surface.
5. **The host's other choices still apply on top.** A chosen accent wins over the ambiance's on the
   same element, because `[data-event-accent]` is declared after the ambiance blocks.
6. **Every ambiance passes the root's contrast bars on its own surfaces** (`tokens.contrast.test.ts`
   measures each block separately). An ambiance that does not is not shippable.
7. **Faces are bundled, never fetched.** Instrument Serif (the display face of every evening) and
   Bricolage Grotesque (the Guinguette's headings), OFL, latin and latin-ext, ship as `woff2` with
   `font-display: swap`. A browser downloads a face only when an element on screen uses it.
8. **An ambiance may photograph its ground.** The Guinguette champêtre ships one photograph of
   string lights in a garden at dusk (Unsplash licence, credited in `web/public/licenses/`, 25 KB
   in WebP) behind the guest's page and the wall, under a grade that keeps text legible. A host
   uploading a photograph of their own venue is the natural next step and is not built.

9. **What the Chambre noire wears beyond its palette**: the event's name in Instrument Serif at
   display size on the guest's phone, a film grain over the page ground, and two safelight leaks
   drifting behind every page but the wall, stopped by reduced motion.

10. **The Guinguette's wall layout is the clothesline** (amended 28/10). `clothesline` is a seventh
    layout in the domain's closed vocabulary: up to five cream-bordered prints pegged to a twine by
    wooden clothespins, tilted by a hash of the photo id like the polaroid, swaying 1.5 degrees about
    the pin, the newest hung larger. It works in every ambiance; the twine and the pins are tokens,
    drawn over a print's top mat and never over a photograph. It is the Guinguette's **default**, and
    that is a suggestion made at the screen and not a setting: the layout belongs to the projector, the
    wall response carries none of the event's own, so `web/src/features/wall/ambianceLayout.ts` maps
    an ambiance to an optional layout and `WallPage` resolves the `L` key, then `?layout=`, then
    that suggestion, then the response's default. No API changed; a kiosk that names its layout keeps
    it. The sway is the second animation that loops on the wall (after Ken Burns): declared from
    `data-motion`, withheld under reduced motion and on a wall that is not advancing, and shed by
    both rungs of the frame-budget ladder.

## Consequences

### Positive

- The product has a look of its own that speaks about photographs rather than about software, at no
  font cost.
- A host chooses a world in one control, and still cannot choose an unreadable screen.
- Ambiances are cheap to add once the mechanism exists: a token block, a contrast run, ornaments in
  CSS, optional wall layout.
- The guest's pending photo shown as a negative tells them "not yet" without a sentence.

### Negative

- **The glass split collapsed.** The ground tier was three points cheaper than the photo tier because
  our own brightest field was an accent button. The paper button is as bright as white, so both floors
  now land on 0.96. The tier test records that rather than demanding a split.
- Each ambiance multiplies the visual baselines of the guest's phone and the wall, so the catalogue
  has to stay small (three or four).
- `:root:has()` makes the page's palette depend on what is mounted inside it. A themed surface left
  mounted by mistake would re-skin whatever surrounds it.
- The default accent hue 305 is now a sentinel meaning "the paper", so violet itself can no longer be
  chosen. A nullable accent would say this better, and is left for the real implementation.

### Neutral

- No migration: `settings` is opaque JSON and an absent `ambiance` reads as the root look, which is
  what every stored theme has been rendering.
- The birthday template starts on the Guinguette; the other three templates keep the root.
- Decorative colours (bulbs, gingham) are tokens of their ambiance and never mark a control, so the
  "one accent, reserved for the action" rule still holds for every control on screen.

## Alternatives considered

- **More independent knobs** (surface hue, ink warmth, heading face). Rejected: the legibility of a
  pair depends on both halves, so independent knobs either need a rule over their product, which is
  an ambiance with extra steps, or let a host build an unreadable screen.
- **Free CSS per event.** Rejected for the same reason, and because the CSP and the baselines make it
  unreviewable.
- **A per-user console theme instead.** Compatible and still possible later, as a reader's
  preference like the language. It does not answer the question, which is about the evening and not
  about the operator's screen.
- **Keeping the slate palette and adding only festive ambiances.** Rejected: the review's finding was
  about the product's own identity, and every evening without a chosen ambiance would still look
  like everybody else's console.

## Related

- [ADR 0006](0006-own-design-system.md): the design system this extends.
- [docs/DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) §12 (per-event theming) and §13 (glass).
- `web/src/design-system/tokens.css`, `web/src/design-system/eventTheme.ts`,
  `src/domain/events/eventTheme.ts`.
