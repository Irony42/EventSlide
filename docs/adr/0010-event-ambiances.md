# ADR 0010 — Event ambiances, and the Guinguette as the product's own look

## Status

Accepted, shipped in 3.1.0 (#254). The field, its storage, its wire shape, the picker, the root
look, six ambiances, the clothesline layout and the host's venue photograph are built and tested.
**Not built**, and said so: ambiance-specific wall layouts (every ambiance has no opinion, and the
clothesline is one `L` away), the ornaments on the wall's join card, the marker strokes in the
moderation console, and a measurement of text over the photographs at the **wall**'s centre (the
phone's top half is measured).

## Date

2026-10-28

## Context

The UI/UX review of 28 October (`eventslide-suivi/rapports/revue-ui-ux-2026-10-28.html`) found that
EventSlide has no identity of its own. Its palette was the default of a dark SaaS console: a slate
ground at hue 265, a lavender accent at 305, the system face, no wordmark. Nothing a guest saw could
tell them which product made the wall they were looking at, and nothing distinguished one evening
from another beyond one accent hue.

The event theme of roadmap 2.2 already lets a host move four things: an accent hue, a font pairing,
a frame style and a material. Each is a closed vocabulary or a single angle, chosen that way so that
no host can pick an unreadable screen. What a host cannot choose is a **world**: the surfaces, the
inks, the faces and the ornaments that together make a wedding look different from a village party.
A fifth independent knob per property would put the legibility rule back in the host's hands, which
is what 2.2 refused to do.

The first prototype made the **Chambre noire** (velvet black, a red safelight, paper as the only
light thing) the product's own look and the **Guinguette champêtre** its first festive ambiance.
**On 28/10 Pierre abandoned the Chambre noire.** What worked in the Guinguette was a real photograph
of a place behind the page, graded so the text stays legible, real materials (kraft, gingham,
linen) and a typeface with character; the darkroom had none of those. The v7 mockup
(`rapports/themes-v7-propositions-2026-10-28.html`) proposed five worlds built the same way, and
Pierre picked four of them to sit beside the Guinguette.

## Decision

1. **An event's theme names an ambiance**: `ambiance: 'guinguette' | 'riviera' | 'champs' |
'bivouac' | 'cabaret' | 'noces'`, beside the accent, the pairing, the frame and the material, in
   `src/domain/events/eventTheme.ts`. It is a closed vocabulary; adding an ambiance is a code change
   with its own review, never host input.
2. **The Guinguette is the root.** It is the product's own look and the default ambiance, so it emits
   no attribute and its values are `:root`'s. The console, the sign-in page and the dashboard wear
   it too, which is intended. The Chambre noire is deleted: its palette, the safelight glow, the two
   drifting leaks and their motion-budget entry.
3. **The other four are blocks in `tokens.css`**, selected by `[data-event-ambiance='…']` on the
   themed surface and by `:root:has(…)` for the page around it, so the body, the header and the
   ornaments follow in the same paint. A template preview in the console is excluded by its marker.
   A block restates everything it moves, and `--accent-texture` and `--button-radius` too, because
   the root has kraft fibres and a rounded control; the wall's join card and the ground are restated
   because a property that references another is substituted where it is declared.
4. **The whole evening wears it, console included.** The guest's phone and the wall are themed
   surfaces; every other page that is about one event carries an `AmbianceMarker`. The accent, the
   pairing and the frame still stay off the console, and the semantic colours are fixed in every
   ambiance, so the moderation queue keeps its working vocabulary.
5. **The host's other choices still apply on top.** A chosen accent wins over the ambiance's on the
   same element, because `[data-event-accent]` is declared after the ambiance blocks. That block also
   drops the kraft fibres (they were measured under the kraft label, not under a hue a host chose) and
   re-derives the wall's join card, which is the accent paper.
6. **Every ambiance passes the same contrast bars on its own surfaces** (`tokens.contrast.test.ts`
   measures each block separately, the Guinguette's being the root's): the inks on all three
   surfaces, the label on its accent, the status glyphs, the border, the focus ring, the accent
   at all 360 hues, the glass over white at the lowest alpha that holds, and the kraft fibres where
   they are darkest. `scripts/ambianceGround.test.ts` reads each bundled photograph, crops it as a
   phone does, applies the declared grade and holds the three inks to 4.5:1 on the 99th percentile
   of the top half; each grade's top alpha is the lowest that holds, with one named exception
   (Bivouac keeps a floor because its night sky is already dark and a flame can sit in the wall's
   centre).
7. **Faces are bundled, never fetched**, OFL, latin and latin-ext, `font-display: swap`. A browser
   downloads a face only when an element on screen uses it. A face that ships one instance is
   declared over a weight range so a bold label never asks the browser to synthesise one.
8. **Each ambiance photographs its ground** (Unsplash licence, credited in `web/public/licenses/`),
   on a fixed layer of its own under a grade, and on the wall behind the layouts.
9. **Ornaments are a fixed strip on the guest's pages and on the console, never on the wall**
   (principle 1: a fixed strip over a projected photograph is the one place they would break it).
   They never move, so reduced motion has nothing to stop.
10. **A host's stored theme may still say `darkroom`**, and so may a guest's `sessionStorage`
    (the prototype ran on Pierre's local database). It is read as `guinguette` in the settings
    parser and in `readEventTheme`, and is written back as that on the next save. The request schema
    accepts the new vocabulary only: a legacy name is read, never written.
11. **A host may replace the ground with a photograph of their own venue** (28/10), one per event,
    for **every** ambiance (each one photographs its ground, the root look included). It is the
    host's, not the ambiance's, so it follows the host through a change of ambiance, and removing it
    brings the ambiance's own back.
    - _Where it lives._ `EventSettings.venuePhoto`, a SHA-256 digest **beside the theme**, not in it:
      a theme is replaced whole by `PATCH /settings`, and a host changing an accent must not be able
      to drop a photograph that arrives by its own route. The wire carries it as `theme.groundUrl`,
      which a settings save reads and ignores (a client echoing the theme back is not refused).
    - _The file._ The existing upload safety, unchanged in kind: format by magic bytes, pixel budget
      from the header, `rotate()` before resize, **all metadata stripped** (a venue photograph carries
      the venue's GPS position), 1600 px WebP at quality 60, re-encoded and never passed through,
      stored as `<event>/ground/<ab>/<sha256>.webp` and served only through the application, only
      while the settings name that digest. It is a `ground` media variant outside the variants a
      photograph's route can name.
    - _Quota._ Not counted: the quota guards guests' photographs and is enforced in a transaction
      over their rows; one file per event, replaced in place and bounded at 1 MiB cannot exhaust it,
      and counting it would let a decoration refuse a guest. The reconciliation sweep, the backup and
      the purge script all know that the settings name a file no row does.
    - _Legibility._ The photograph is nobody's measured photograph, so it is **not** held to the
      derived per-photograph grade, and no per-photo measurement is attempted. It is held to
      something stronger and simpler: the ambiance's own grade plus one more coat of its own surface
      colour (`--ambiance-scrim`, declared in each block: 0.30, and 0.70 for the Bivouac, whose
      bundled photograph is dark and whose grade is therefore thin), and
      `scripts/ambianceGround.test.ts` proves all three inks keep 4.5:1 over a **pure white**
      photograph, the brightest a photograph can be, in each of the six. Any real photograph is
      darker than that bound. What it does not promise is that a venue photograph looks good under
      the grade, only that it cannot make the text unreadable.
    - _Painting without a flash._ `html::before` can only read the root's custom properties, so the
      photograph travels as an **inline custom property on the element that is dressed** (the themed
      surface, or the ambiance marker, which then is not `hidden`), set in the same render. That
      element paints its own fixed `::before` with the same grade, the scrim and the same stack
      position, the root's bundled layer is emptied, and on the wall `[data-venue-ground='wall']`
      re-declares `--wall-ground` with the scrim layered in. The template preview is excluded like
      every ambiance rule. The URL is only accepted if it matches the path this product mints, since
      it is written into a CSS `url()`.
    - _Not done, said so._ The shared gallery shows the ambiance's own ground (its route is the
      wall's, which an archived event does not serve). A projector that is already running learns of
      a new photograph at its next playlist change or reload until `sameSettings` in the wall's
      playlist hook compares `theme.groundUrl`; that hook belongs to the wall's own change and is
      recorded in the pull request.

### What each ambiance is

| Ambiance (fr) | Palette and ground                                                                                | Faces                                           | Ornament                                   | Control      |
| ------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------ | ------------ |
| Guinguette    | wood-brown, cream, kraft; a garden's string lights                                                | Instrument Serif, Bricolage Grotesque           | filament bulbs on top, gingham below       | rounded      |
| Riviera       | navy, a sail's white; a sea at sunset                                                             | Playfair Display                                | breton stripe top and bottom               | pill         |
| Champs d'or   | earth, honey; tall grass in golden light                                                          | Fraunces                                        | linen strip below                          | pill         |
| Bivouac       | night blue, ember; a campfire under stars                                                         | Bricolage Grotesque (800)                       | tartan strip below                         | small radius |
| Cabaret       | ebony, champagne gold; a velvet curtain                                                           | Poiret One, Playfair Display for headings       | art-deco fan line, double rule             | square       |
| Noces         | **light**: white and ivory, wine-grey inks, crimson; red roses on white paper under an ivory veil | Instrument Serif, Playfair Display for headings | thin red double rule, a line of red petals | pill         |

The Noces is the one **light** ambiance (Pierre, 28/10: "des menus dans les tons blancs et des
highlights rouges"). Light is a **polarity**, and the tests treat it as one rather than as an
exception: whichever side of its grade an ink lies on decides which end of the photograph is the
worst case.

- `scripts/ambianceGround.test.ts` holds a light ink to the 99th percentile (brightest) of the
  graded photograph and a dark ink to the **1st** (darkest); the lowest-top-alpha derivation runs
  both ways. The host's-own-photograph check uses **pure white** under a dark grade and **pure
  black** under a light one. The grade is an ivory veil (0.74 at the top, the lowest that holds).
- `tokens.contrast.test.ts` picks the worst photograph under the glass the same way, and measures
  the wall's inks, the wall's join card (white paper, red ink) and the `--surface-scrim` (ivory
  in the Noces, so a caption's dark ink reads over a black photograph) in every ambiance.
- The semantic colours are restated darker in the Noces (the root's are tuned for dark surfaces),
  and a host's chosen accent hue is derived by the Noces' own rule
  (`[data-event-ambiance='noces'][data-event-accent]`, 40% lightness, white label) because the
  generic pastel derivation cannot be read on ivory. The accent is 45% lightness: the 7:1 bar for
  the accent on `--surface-base` is what caps it, not taste.

### What it costs, in bytes (all lazy: nothing downloads until the ambiance is on screen)

- Photographs: 25 KB (Guinguette), 26 KB (Riviera), 104 KB (Bivouac), 106 KB (Champs d'or), 90 KB
  (Cabaret, re-encoded at 1400 px wide), 109 KB (Noces).
- Faces: Instrument Serif 67 KB and Bricolage Grotesque 56 KB (root), Playfair Display 73 KB,
  Fraunces 146 KB, Poiret One 13 KB, each for all of its styles and both subsets; a phone fetches
  the latin subset of the styles it shows, a third to a half of that.

## Consequences

### Positive

- The product has a look of its own that speaks about photographs rather than about software, and
  a guest, a host and the room all see the same one.
- A host chooses a world in one control, and still cannot choose an unreadable screen.
- Ambiances are cheap to add once the mechanism exists: a token block, a photograph, a contrast run,
  ornaments in CSS.

### Negative

- **The glass split is back to a few points.** On the Guinguette's raised brown the photograph floor
  is 0.96 and our own ground 0.93, because the kraft button is darker than white.
- Each ambiance multiplies the visual baselines of the guest's phone and the wall, so the catalogue
  has to stay small.
- `:root:has()` makes the page's palette depend on what is mounted inside it. A themed surface left
  mounted by mistake would re-skin whatever surrounds it.
- The wall's loading and error states carry no layout marker, so for a moment the ornaments are
  excluded only by the layout once it is known.
- The wall still carries the markup and stylesheet of the blurred letterbox (`--wall-ambient`),
  switched off by a token because every ambiance paints a ground of its own. Deleting it touches the
  wall's own folder and is left to that change.
- The default accent hue 305 is a sentinel meaning "the product's own kraft", so violet itself can no
  longer be chosen. A nullable accent would say this better.
- Poiret One is a hairline face: it is the event's name and the wall's captions in the Cabaret, not
  body text, and the wall's scrim is what carries it over a photograph.

### Neutral

- No migration: `settings` is opaque JSON and an absent `ambiance` reads as the Guinguette.
- Templates: wedding starts on Champs d'or, party on Bivouac, birthday and conference on the
  Guinguette.
- Decorative colours (bulbs, gingham, linen, stripes, tartan, gold) are tokens of their ambiance and
  never mark a control, so the "one accent, reserved for the action" rule still holds.

## Alternatives considered

- **More independent knobs** (surface hue, ink warmth, heading face). Rejected: the legibility of a
  pair depends on both halves, so independent knobs either need a rule over their product, which is
  an ambiance with extra steps, or let a host build an unreadable screen.
- **Free CSS per event.** Rejected for the same reason, and because the CSP and the baselines make it
  unreviewable.
- **A per-user console theme instead.** Compatible and still possible later, as a reader's
  preference like the language. It does not answer the question, which is about the evening.
- **Keeping the Chambre noire as the root and adding festive ambiances.** Rejected by Pierre on
  28/10: it had no photograph, no material and no face of its own beyond a palette.

## Related

- [ADR 0006](0006-own-design-system.md): the design system this extends.
- [docs/DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md) §12 (per-event theming) and §13 (glass).
- `web/src/design-system/tokens.css`, `web/src/design-system/base.css`,
  `web/src/design-system/eventTheme.ts`, `src/domain/events/eventTheme.ts`.

## Amendment of 29/10: the default look is the violet again, the Guinguette an ambiance, the glass visible

**Decision (Pierre, 29/10):** « Par défaut le thème guinguette ça va pas. Remet le thème violet avec
l'effet liquid glass qu'on avait avant par défaut, mais garde les thèmes au choix. » This reverses
decision 2 above and nothing else; every other decision of this ADR stands.

1. **A new default ambiance, `eventslide`** (« EventSlide »), listed first in `THEME_AMBIANCES`
   (domain and web mirror) and in `THEME_FACES`. It is the 3.0 look: a slate ground at hue 265, the
   lavender accent at 305, the system face, the 3.0 radii. It is the `:root` again and emits no
   attribute; `DEFAULT_EVENT_THEME.ambiance` is `eventslide`. No ornament, no photograph.
2. **The Guinguette is an ordinary block**, `[data-event-ambiance='guinguette']` with its
   `:root:has()` twin, carrying everything the root carried from 3.1.0 to today (palette, kraft
   fibres, faces, ground photograph, grade, wall ground, glass tints, decor tokens); its bulbs and
   gingham in `base.css` are keyed on its own marker like the others'.
3. **Stored data.** An event whose stored theme has **no** `ambiance` (written before 3.1) now reads
   `eventslide`: that is what it rendered before 3.1, so it is the least surprising reading.
   `restoreEventTheme` is unchanged (it validates what it is given), the repository's
   "added later" rule and the web's `readEventTheme` both fall back to `DEFAULT_EVENT_THEME` and
   so agree, and tests pin the three. **An event that stored `guinguette` explicitly stays on the
   Guinguette**, and that includes an event created on 3.1.0 with the default theme, whose settings
   carry `guinguette` in full: the data cannot tell it from a choice, and a host sees the pick in
   the settings form and changes it there. **The legacy name `darkroom` now maps to `eventslide`**
   (it was the old dark default, which is what the violet is), in the domain's `LEGACY_AMBIANCES`
   and in the web's `readThemeAmbiance`, and is written back as that on the next save.
4. **Templates.** Birthday and conference now choose `eventslide`; wedding (Champs d'or) and party
   (Bivouac) are unchanged.
5. **The glass is made visible, and its alpha is still derived.** Over a white photograph the
   palette's headroom leaves a pane at 0.95, five per cent of the world, which nobody reads as
   glass; over a dark ground a lower alpha is legible but shows almost nothing (a pane can be at
   most as light as `--surface-overlay` at its worst pixel, so the visible modulation is bounded by
   five points of lightness whatever the alpha). The lever that moves the worst case is the
   backdrop, so `--glass-filter` now ends in `brightness(var(--glass-brightness))` with `0.32`:
   what a pane meets is scaled to at most that grey before the tint lands on it, and the floors are
   derived against that grey. Results, by the same bars and the same "one point thinner fails":
   **photo tier 0.80** (white dimmed), **ground tier 0.61** (the lighter of the lightest accent field
   and the aurora's brightest pixel, dimmed). The ambiances inherit the dimming and keep the tints
   they had (derived over undimmed white: conservative for a light ink, unmoved for a dark one).
   `plain` is still `--surface-raised` at full alpha with no filter, and reduced transparency and
   more contrast still land there.
6. **The aurora**: the root's ground is three static radial glows (violet, indigo, lavender, each a
   token at 24 to 25% lightness) over the slate base, painted like every other ground (`html::before`,
   behind the wall). Text sits on it directly, so the per-channel maximum of the base and the three
   glows, which bounds every pixel of it, is held to 12, 7 and 4.5:1 for the three inks.
   **A host's own venue photograph under the root look** is covered by a flat coat of 90% of the
   base, the lowest share that keeps all three inks above 4.5:1 over pure white (derived, one point
   thinner fails): this palette's dim inks ask for more of it than the Guinguette's warm ones, so
   the photograph is mostly veiled there.

**Follow-ups on review (29/10).** Noces and Sur mesure light restate `--glass-brightness: 1` and the
filter that reads it (their worst photograph is black, which dimming cannot move; a dimmed bright
backdrop would grey a light pane). A miniature (template preview, the settings frames) always
carries `data-event-ambiance`, the default included, and `:root` and
`[data-event-ambiance='eventslide']` share one declaration block, so a preview of the violet inside
a page that wears another ambiance takes the root look back. The Guinguette restates `--qr-field`,
`--qr-ink` and `--glass-opaque` for the same reason. **`--surface-scrim` moves from 0.82 to 0.83 in
Riviera, Champs d'or, Bivouac and Cabaret**, which inherited the root's: one point denser, held by
the same wall bars; the Guinguette restates its own 0.82. Events saved as `guinguette` on 3.1.0 are
not migrated.

**Not done, said so.** The ambiances keep the 0.96 and 0.93 tints
they had; making them as visible is a per-ambiance derivation.

## Proposed amendment (30/10), not merged: clear glass, the bar moves from the pane to the content

Status: **proposed on `exp/glass-visible`, a prototype for Pierre to validate.** Nothing above is changed.

**The problem the 3.2.0 measurements showed.** The rule above measures legibility where the pane
is: text sits on the tint, so the tint must hold every ink at its bar over the worst backdrop, which
puts it at 0.80 to 0.96. A pane that is 80 to 96 per cent opaque shows 0.3 to 0.7 per cent of its
backdrop (`glass-check`), which nobody reads as glass.

**The change.** Flip the rule, as Apple does. The pane becomes genuinely transparent
(`--glass-clear-*`: blur 28 px, saturation 170 %, `--surface-raised` at 34 % on dark ambiances and
20 % on the two light ones, a white sheen of 16 % / 5 %, a 1 px lit edge and an inner highlight), and
legibility moves onto the content: every word on the pane stands on an opaque chip, either a
control's own fill or `.chip` (`--surface-raised`, no alpha) or a card of its own (the unfolded
caption and video sections, the privacy notice). No text is ever measured against the backdrop, so
the backdrop can be anything, and no tint has to be derived against a worst photograph.

**Bars are not weakened, they are measured elsewhere.** The inks keep 12 / 7 / 4.5:1, on
`--surface-raised`, which `tokens.contrast.test.ts` already holds for every ambiance and
`glass.clear.test.ts` restates for the chip. The browser half (every text node of the composer has an
opaque painted ancestor inside the pane, in the gated, empty, unfolded, queued and sent states, in
three ambiances) is `tests/e2e/journeys/glass-chips.spec.ts`. The old tints and their sweeps are
untouched and still govern `.sheet` (the moderation toolbar).

**Unchanged.** `plain` and `data-glass='opaque'`, `prefers-reduced-transparency`,
`prefers-contrast: more` and a browser with no `backdrop-filter` all set the clear alpha to 100 %,
the filter to none and the sheen to 0, so the pane is the same opaque surface as before. A browser
without `color-mix` keeps an opaque first `background`.

**Cost.** Every new text on a clear pane needs a chip, and the walker is what notices a forgotten
one. The composer and the gallery's download bar wear it; the moderation toolbar stays on `.sheet`.
