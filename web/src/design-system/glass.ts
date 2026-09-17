/**
 * Which surfaces may afford the glass material — roadmap 11.3.
 *
 * The material itself is `tokens.css` plus `glass.module.css`. This file holds the one
 * decision neither of them can express: **which of the three surfaces gets the blur and
 * which gets the opaque fallback**, decided in advance rather than discovered at a
 * wedding in front of two hundred people.
 *
 * ## The rule, and the mechanism it comes from
 *
 * `backdrop-filter` is cheap over still content and expensive over moving content. The
 * compositor blurs the backdrop once and keeps the result until something behind the
 * pane changes; when the backdrop changes every frame, it blurs every frame, at the
 * pane's full size.
 *
 * That makes the answer a property of the surface rather than of the device. The guest's
 * phone and the host's laptop show panes over content that is still between
 * interactions. The wall never is: it is crossfading, running Ken Burns, and — since
 * roadmap 1.4 — may be decoding a video clip while it does both, on whatever mini-PC the
 * venue owns, unattended, for eight hours. So the room takes the fallback and the guest
 * keeps the blur. Roadmap 11.3 calls that an acceptable outcome; this is where it is
 * written down.
 *
 * ## Why this is a rule and not a `@media` query
 *
 * A device capability belongs in `@supports`, and a person's preference belongs in
 * `@media` — `tokens.css` has both, and neither can say "this surface, on any machine".
 * The room is not a slower device; it is a surface whose content never stops moving, and
 * that is true of a venue mini-PC and of a developer's workstation alike.
 *
 * ## Why an attribute and not a class or a second stylesheet
 *
 * Custom properties inherit, so one attribute on the surface element re-declares the
 * material for everything inside it in the same paint. No primitive learns that tiers
 * exist, no component chooses, and there is no second copy of the material to keep in
 * step with the first. It is the mechanism per-event theming already uses and for the
 * same reasons (`eventTheme.ts`): props rendered with the content they govern, never a
 * `:root` write from an effect that lands a frame late.
 */

/**
 * The three surfaces of CLAUDE.md §1, restated here rather than imported from
 * `app/AppShell`.
 *
 * The design system may not depend on the application shell — the arrow points the other
 * way — and `eventTheme.ts` states its own `ThemedSurface` for the same reason.
 */
export type GlassSurface = 'guest' | 'host' | 'wall'

/**
 * What the material costs on a surface.
 *
 * `blur` is the material as designed. `opaque` is the same material with the tint at
 * full strength and no filter: not a degraded look, because the colour it lands on is
 * `--surface-raised`, which this product already ships everywhere else.
 */
export type GlassTier = 'blur' | 'opaque'

/** The rule itself, in one line, so that it can be read without reading the plumbing. */
export const glassTierFor = (surface: GlassSurface): GlassTier =>
  surface === 'wall' ? 'opaque' : 'blur'

/**
 * The marker `tokens.css` re-declares the material on.
 *
 * Optional and **absent** rather than `undefined`: under `exactOptionalPropertyTypes`
 * those are different types, and a surface on the blur tier must render the DOM it
 * rendered before this existed. That is the same promise the default event theme makes,
 * and it is what lets the wall's committed baselines stay committed.
 */
export interface GlassSurfaceProps {
  readonly 'data-glass'?: GlassTier
}

/** What a surface element spreads onto itself. Applied by `AppShell`, and nowhere else. */
export const glassSurfaceProps = (surface: GlassSurface): GlassSurfaceProps => {
  const tier = glassTierFor(surface)
  return tier === 'blur' ? {} : { 'data-glass': tier }
}
