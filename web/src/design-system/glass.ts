/**
 * Which surfaces may afford the glass material — roadmap 11.3, and the tier split of 11.2.
 *
 * The material itself is `tokens.css` plus `glass.module.css`. This file holds the two
 * decisions neither of them can express: **what the material costs here**, which is what
 * the room cannot afford, and **what can be painted underneath it**, which is what decides
 * how opaque the tint has to be. They are independent questions with independent answers,
 * and one function composes them.
 *
 * ## The second question, and why it is not the same as the first
 *
 * A pane's legibility comes from its tint's alpha and from nothing else. So the floor it
 * needs depends entirely on what can render beneath it, and this product has two cases:
 *
 * - **A guest's photograph**, which is unbounded. The worst case is pure white, and the
 *   floor that survives it leaves 5% of the backdrop showing.
 * - **Our own ground**, which is not. Every colour that can be painted there is a token
 *   this product chose, so the worst case is the brightest *field* a stylesheet paints —
 *   enumerable, and measured in `tokens.contrast.test.ts` rather than assumed.
 *
 * The second floor is three points of alpha lower than the first. That is the whole of the
 * gain and it is stated rather than dressed up: the reason it is not larger is
 * `--text-muted`, which clears 4.62:1 on `--surface-overlay` against a 4.5 target, so the
 * palette has about a tenth of a ratio point of headroom whatever is behind the pane.
 *
 * **The conservative tier is the default**, and that is the load-bearing half. A surface
 * that says nothing gets the floor that survives a photograph; claiming the translucent
 * one is a positive act, and `app/glassBackdrop.ts` is where a route makes the claim —
 * checked against the real import graph, because a claim nobody verifies is a claim
 * somebody will eventually get wrong on the moderation queue.
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

// Type-only in the other direction, so the two files do not form a cycle at run time:
// `budget.ts` needs to name a surface and this file needs the ladder's answers.
import { affords, budgetFloorFor, type BudgetLevel } from './budget'

/**
 * The three surfaces of CLAUDE.md §1, restated here rather than imported from
 * `app/AppShell`.
 *
 * The design system may not depend on the application shell — the arrow points the other
 * way — and `eventTheme.ts` states its own `ThemedSurface` for the same reason.
 */
export type GlassSurface = 'guest' | 'host' | 'wall'

/**
 * What can be painted beneath a pane on this screen.
 *
 * `photo` does not mean "there is a photograph on it". It means **this screen can paint
 * something at least as bright as one**, which a guest's upload always can and one thing
 * of our own also does: the QR plate on an event's page is `--text-primary`, a near-white
 * field, and a contrast ratio cannot tell it apart from a white dress in full sun. So the
 * question the tier asks is about brightness rather than provenance, and "no guest photo
 * here" is not on its own an answer.
 *
 * `ground` is the claim that neither can happen — that everything beneath the pane comes
 * from the palette, no brighter than the backdrop the ground floor was derived against.
 */
export type GlassBackdrop = 'ground' | 'photo'

/**
 * The host's answer for their own event: whether it wears the material at all.
 *
 * Roadmap 11.5, and the third input to a decision that had two. `glass` is what every
 * event renders today and the default a host who never opened the settings page keeps;
 * `plain` is the opaque tier, which is not a degraded look — `--glass-opaque` **is**
 * `--surface-raised`, the panel this product ships on every other screen.
 *
 * It is per **event** and not per device on purpose. A device already has three answers of
 * its own — `@supports`, `prefers-reduced-transparency`, and the runtime budget below —
 * and every one of them is about what this machine can do or what this person asked the
 * machine for. None of them can answer "what should my evening look like", which is a
 * decision about the room rather than about the hardware in it, and two phones in the same
 * room must not disagree about it.
 *
 * Named for the material rather than as a boolean, so it reads beside `fonts` and `frame`:
 * a theme names the face, the frame and the surface, and none of the three is an on-off
 * switch wearing a costume.
 *
 * **Declared here rather than imported from `lib/api/dto`**, the way `GlassSurface` above is
 * restated rather than imported from the shell: the design system's rule does not depend on
 * the shape of a wire. What binds the two spellings is the one call site that joins them,
 * `eventTheme.ts`' `glassMaterialProps(theme.material)` — so a value added to the wire's
 * vocabulary and not to this one is a compile error there, which is the only direction that
 * could reach a screen. A value added here and nowhere else has no producer.
 */
export type GlassMaterial = 'glass' | 'plain'

/**
 * What the material costs on a surface, and which floor its tint is held to.
 *
 * `photo` is the material at the floor that survives an unknown photograph — the tier
 * roadmap 11.1 derived, and the one a surface gets by saying nothing. `ground` is the same
 * material three points of alpha more translucent, for a pane that can only ever meet our
 * own colours. `opaque` is the tint at full strength with no filter: not a degraded look,
 * because the colour it lands on is `--surface-raised`, which this product already ships
 * everywhere else.
 */
export type GlassTier = 'ground' | 'photo' | 'opaque'

/**
 * The rule itself, in one expression, so that it can be read without reading the plumbing.
 *
 * The room's answer does not depend on the backdrop and the backdrop's answer does not
 * depend on the room, which is why this is a composition of two questions rather than a
 * table of six cases. The wall is `photo` by backdrop as well — it is nothing but guest
 * photographs — and it never gets to matter, because a surface that cannot afford the
 * filter has no tint to choose.
 *
 * **"The room cannot afford it" is not written here any more; it is the first rung of
 * `budget.ts`.** That matters because roadmap 11.3 added a second way to arrive at the same
 * place — a machine measured, at runtime, as not coping — and two spellings of one decision
 * is how they come to disagree. `budgetFloorFor` says where a surface starts and `level`
 * says where it has got to; both answer the one question `affords` asks.
 *
 * ## Three answers, and the order they are taken in
 *
 * Roadmap 11.5 adds the host's, so three things now want a say. The precedence is decided
 * here rather than discovered, and `glass.test.ts` holds both halves of it:
 *
 * 1. **The host's `plain` is final.** Nothing puts the material back — not a device that
 *    can afford the filter, not a frame rate that recovered, not an address that earns the
 *    translucent floor. Degradation is one-way in this file's neighbour and it is one-way
 *    here, for a related reason: a host who chose the plainer surface for their evening is
 *    not asking to be second-guessed by whichever machine is holding the page.
 * 2. **The budget outranks the host's `glass`.** Shedding the material is a health answer,
 *    not a taste one — a wall holding its frame rate in front of a hundred people, and an
 *    upload screen that answers a thumb. A host who asked for glass on a machine that
 *    cannot afford it gets the opaque tier, and is not told, because there is nothing they
 *    could usefully do about it at 23:00.
 *
 * Read together the two say the same thing: **every answer may take the material away and
 * none may give it back.** That is why the composition needs no table of twelve cases, and
 * why the marker a themed surface spreads is `opaque` or nothing at all.
 */
export const glassTierFor = (
  surface: GlassSurface,
  backdrop: GlassBackdrop = 'photo',
  level: BudgetLevel = budgetFloorFor(surface),
  material: GlassMaterial = 'glass',
): GlassTier => {
  if (material === 'plain') return 'opaque'
  return affords(level, 'glass') ? backdrop : 'opaque'
}

/**
 * The marker `tokens.css` re-declares the material on.
 *
 * Optional and **absent** rather than `undefined`: under `exactOptionalPropertyTypes`
 * those are different types, and a surface on the default tier must render the DOM it
 * rendered before this existed. That is the same promise the default event theme makes,
 * and it is what lets the wall's committed baselines stay committed.
 */
export interface GlassSurfaceProps {
  readonly 'data-glass'?: Exclude<GlassTier, 'photo'>
}

/**
 * The same marker, narrowed to the one value a themed surface is allowed to declare.
 *
 * A separate type rather than a reuse of the one above, and the narrowing is the point: it
 * is `glassMaterialProps`' one-way rule expressed where the compiler can hold it, so the
 * tidy-looking edit that spells the tier out in full does not typecheck.
 */
export interface GlassMaterialProps {
  readonly 'data-glass'?: 'opaque'
}

/**
 * What a surface element spreads onto itself. Applied by `AppShell`, and nowhere else.
 *
 * `photo` spreads nothing, because it is what `tokens.css` already declares on `:root`.
 * That is not only tidiness: it means a surface that forgets to say anything is held to
 * the strictest floor rather than to the loosest, which is the only safe direction for a
 * default to fail in.
 */
export const glassSurfaceProps = (
  surface: GlassSurface,
  backdrop: GlassBackdrop = 'photo',
  level: BudgetLevel = budgetFloorFor(surface),
): GlassSurfaceProps => {
  // As if the host had asked for the material, because the shell cannot know whether they
  // did: it renders above the page that fetches the event, and nothing travels up a React
  // tree in the same paint. What the host chose is declared on the themed surface below,
  // by `glassMaterialProps`, and can only take this answer further down.
  const tier = glassTierFor(surface, backdrop, level, 'glass')
  return tier === 'photo' ? {} : { 'data-glass': tier }
}

/**
 * The marker a **themed surface** spreads, below the shell — roadmap 11.5.
 *
 * `opaque`, or nothing at all, and the return type is what says so. A themed surface is a
 * descendant of the shell, and a tier declared on a descendant wins for its own subtree
 * whatever the specificity of the two selectors (§13). So a surface that spelled its tier
 * out in full — `data-glass="ground"` for a host who chose glass, which is the tidy-looking
 * version of this function — would put a blur back on a machine that had already given it
 * up, and on the projector. The asymmetry is the feature: **the host may take the material
 * away and may not give it back.**
 *
 * It is spread by `eventTheme.ts` with the rest of the event's look rather than by
 * `AppShell`, for the reason that file gives for the accent: the theme and the content it
 * themes are one render and one paint, so nothing blinks.
 */
export const glassMaterialProps = (material: GlassMaterial): GlassMaterialProps =>
  material === 'plain' ? { 'data-glass': 'opaque' } : {}
