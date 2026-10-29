# ADR 0011 — A host's own ambiance, « Sur mesure »

## Status

Proposed (28/10), on `feat/custom-ambiance`, stacked on `feat/ambiances-proto` (ADR 0010).

## Date

2026-10-28

## Context

ADR 0010 gave an event six ambiances, each a world a designer measured: surfaces, inks, faces, a
photograph and its grade. Pierre asked on 28/10 whether the host could make their own: upload an
image, choose colours, and see the result on a simulation page before saving.

Two pieces already exist. The host's **venue photograph** (ADR 0010, decision 11) replaces any
ambiance's ground, and is held legible by a worst-case bound rather than by a measurement. The
**accent hue** (roadmap 2.2) is a single angle precisely so that no host can pick an unreadable
lightness. What a host cannot choose today is the ground itself: light or dark, and its tint.

The rule this product has kept since 2.2, and that this ADR keeps, is that **a host chooses
things that cannot be wrong**. A free colour picker for the surface and the text would hand the
contrast rule back to the host, and a wall that one guest in ten cannot read is the defect, whatever
the host intended.

## Decision

1. **A seventh ambiance, `custom`, labelled « Sur mesure »**, in the closed vocabulary of
   `src/domain/events/eventTheme.ts`. Choosing it adds a `custom` object to the theme, required when
   the ambiance is `custom` and refused otherwise:
   - `ground: 'light' | 'dark'`: the polarity of the surfaces and inks;
   - `groundHue: 0–359`: the tint of the surfaces, an angle like the accent;
   - `faces: ThemeAmbiance` (not `custom`): whose faces, display weight and control radius to
     borrow, so the five bundled families stay the only ones (ADR 0010, decision 7).
     The accent stays the theme's existing `accentHue`; decision 8 says which rule it answers to.
2. **Every colour is derived from those angles, at fixed lightness and chroma**, the way
   DESIGN-SYSTEM §2 derives the accent. Two blocks in `tokens.css`,
   `[data-event-ambiance='custom'][data-ambiance-ground='light' | 'dark']` (and the `:root:has()`
   twin), compute surfaces, borders, inks, glass tints, the wall's scrim and join card and the QR
   plate from `--ground-hue` and `--accent-hue`. `--ground-hue` is set inline like `--accent-hue`:
   a computed **angle**, the one category of custom property JavaScript may set. The dark block's
   accent is the root's derivation (L72, dark label); the light block's is the Noces' (L40, white
   label), because a pastel accent on ivory is unreadable at any hue.
3. **The proof is a sweep, not a runtime check.** `tokens.contrast.test.ts` runs every bar of
   ADR 0010 decision 6 for both polarities at **every** ground hue crossed with every accent hue the
   domain accepts (every degree of the accent, since decision 8; the ground likewise). Because every hue
   holds, the domain refuses nothing for legibility here; it refuses only a malformed `custom`
   object. A tone that fails at one hue fails the build, never a host's save.
4. **The ground is the venue photograph, or none.** With a photograph, it is painted under the
   polarity's worst-case coat: the coat `scripts/ambianceGround.test.ts` proves keeps all three inks
   at 4.5:1 over pure white (dark ground) or pure black (light ground). No measurement of the
   host's file is attempted, as in ADR 0010 decision 11, so changing polarity never needs the file
   again. Without one, the surface colour and the root's grain, no bundled photograph.
5. **The semantic colours follow the polarity**, as the Noces does: the dark block keeps the root's,
   the light block restates them darker. Status colours stay hue-fixed, so the moderation queue
   reads the same.
6. **The editor is a simulation page**, `/admin/events/:slug/settings/ambiance`, reached from
   Réglages → Ambiance → « Sur mesure ». Controls on one side (polarity, two hue sliders over the
   whole circle (every hue is accepted, decision 8; the accent swatch is drawn in the chosen polarity's tone), faces as a list rendered in
   their own face, the venue photograph's existing field). The other side renders the **real**
   components, live, with the draft theme: the guest's welcome and upload screen in a phone frame,
   and the wall (spotlight, caption, join card with its real QR) in a 16:9 frame, both with the
   event's own published photographs when it has any and a bundled sample otherwise. The frames
   carry `data-template-preview`, so the draft never dresses the page around them. Nothing is
   stored until « Enregistrer », which is the existing `PATCH /settings`.
7. **A draft that the server refuses is shown refused, not corrected** (roadmap 2.2's rule): the
   slider keeps the host's angle, the preview shows it, and the save button says why it cannot save.
8. **A host-made theme answers only to the contrast bars, not to the status distance** (Pierre,
   28/10, after a red-and-white wedding was refused). For `ambiance: 'custom'`, `createEventTheme` runs
   `accentContrastFailure` and skips the distance to `--success`, `--danger` and `--warning` that
   ADR 0010 and roadmap 2.2 apply to every designed ambiance, which keep it unchanged. The reason is
   DESIGN-SYSTEM section 8: **colour is never the sole carrier of a status.** Every alert surface keeps an
   icon and a word (`Notice`, `Badge`, `Toast`, `WallNotice`, the wall's failure screen, the upload queue's
   badge and sentence, the moderation card's badge, the swipe card's hint), so a red, green or yellow
   accent cannot be mistaken for one; and a wedding in red is the case this product most needs to
   serve. Legibility is unchanged: decision 3's sweep covers every accent hue on both polarities. The
   rule is therefore the same on both polarities and the domain does not need to measure the light
   derivation's own tones; the status-distance numbers stay pinned to `tokens.css` for the designed
   ambiances.

## Consequences

### Positive

- A host can give an evening their own colours and venue without any way to make it unreadable.
- No new colour is declared outside `tokens.css`; two blocks and one angle.
- The simulation page is the components themselves, so it cannot drift from what guests see.

### Negative

- Two lightness/chroma scales per polarity must hold at every hue, which constrains them: a very
  saturated ground is not offered, on purpose.
- The worst-case coat is denser than a measured grade would be; a light venue photo under a light
  ground is faint. Measuring the host's file at upload could thin it later, and is not built.
- One more route and page in the console to keep translated in five languages.

### Neutral

- An event switching from `custom` to a designed ambiance drops its `custom` object; the venue
  photograph stays, as decision 11 of ADR 0010 already says.

## Alternatives considered

- **Free colour pickers for surface and text, refused below 4.5:1.** Rejected: most of the space
  is refused, the host learns the rule by trial and error, and the rule would be checked per pair
  at save time instead of proven once.
- **Measure the uploaded photograph and derive its grade.** Deferred: correct and kinder to the
  photograph, but it ties the stored theme to one file's statistics; the worst-case bound is
  already proven.
- **Let the host upload a font.** Rejected: an untrusted font is a parser attack surface, and
  ADR 0010 decision 7 bundles faces on purpose.

## Related

- ADR 0010 (ambiances, venue photograph), roadmap 2.2 (event theme), DESIGN-SYSTEM §2 and §8.
