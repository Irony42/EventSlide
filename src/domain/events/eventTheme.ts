import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import { contrastRatio, oklabDistance, type Oklch } from './contrast'

/**
 * The look a host gives one event: an accent hue, a font pairing and a frame style.
 *
 * Roadmap 2.2. It serves the room first — a wedding in dusty pink and a corporate
 * launch in a company blue should not look like the same product on the projector — and
 * the host second, since choosing it is their job.
 *
 * ## Why this is domain code and not CSS
 *
 * "Can the room read a caption on this palette from ten metres" is a rule about what the
 * product will let a host do. A stylesheet cannot refuse; it can only render whatever it
 * is given, badly. So the rule lives here, with the ratios the design system already
 * publishes (docs/DESIGN-SYSTEM.md section 8), and a host who asks for something the rule
 * refuses is told why rather than quietly moved to something else. Silent correction is
 * worse than a refusal: the host sees a colour they did not pick, cannot tell whether it
 * saved or not, and tries again.
 *
 * ## Why a hue and not a colour
 *
 * The design system derives every accent state by moving lightness only, at a fixed hue
 * and chroma (section 2). An event therefore has exactly **one** degree of freedom, and
 * it is an angle. That is what makes the whole feature safe: no host can pick a
 * lightness, so no host can pick an unreadable one, and the palette a hue produces is a
 * function this module can check before it is stored.
 *
 * It is also what lets the theme reach CSS without inventing a colour outside
 * `tokens.css`: `--accent-hue` is a computed **angle**, which is the one category of
 * custom property the design system allows to be set from JavaScript, beside the Ken
 * Burns duration and the polaroid's tilt.
 *
 * ## What the three L/C pairs below are
 *
 * They are the derivation rule of docs/DESIGN-SYSTEM.md section 2, restated so the rule
 * can compute the palette a hue will produce. They are deliberately *not* a second
 * palette: `tokens.css` remains the only place a colour is declared, and
 * `src/interface/http/presenters/eventThemeContract.test.ts` reads that file and fails if
 * these numbers and the stylesheet ever disagree.
 */

/** Perceptual lightness and chroma, fixed by the design system; the hue is the variable. */
interface Tone {
  readonly l: number
  readonly c: number
}

/** `--accent`: the primary action, and the only coloured chrome on the wall. */
export const ACCENT_TONE: Tone = { l: 0.72, c: 0.17 }
/** `--accent-strong`: hover and pressed. Lightness down, chroma up, hue unchanged. */
export const ACCENT_STRONG_TONE: Tone = { l: 0.64, c: 0.19 }
/** `--accent-contrast`: the ink written on top of the two above. */
export const ACCENT_INK_TONE: Tone = { l: 0.18, c: 0.02 }

/** docs/DESIGN-SYSTEM.md section 8: the label on every primary button, at rest. */
const INK_ON_ACCENT_MIN = 7
/**
 * The same ink on the hover state, held to AA rather than to 7:1.
 *
 * Not a relaxation invented here. `--accent-strong` sits at 64% lightness, so even pure
 * black on it measures 5.74:1 and 7:1 is unreachable at any hue; the design system
 * records that and holds the pair to 4.5. Asserting 7 would refuse every theme,
 * including the one the product ships with.
 */
const INK_ON_ACCENT_STRONG_MIN = 4.5

/**
 * The status tokens, whole rather than as angles — they are what an accent is measured
 * against, and each carries its own lightness and chroma. `tokens.css` is the source;
 * `eventThemeContract.test.ts` fails if these drift from it.
 */
export const STATUS_COLOURS = {
  success: { l: 0.76, c: 0.16, h: 155 },
  danger: { l: 0.68, c: 0.19, h: 22 },
  warning: { l: 0.82, c: 0.15, h: 85 },
} as const satisfies Record<string, Oklch>

/** Kept for the picker's labelling; the rule itself no longer reasons in angles. */
export const STATUS_HUES = {
  success: STATUS_COLOURS.success.h,
  danger: STATUS_COLOURS.danger.h,
  warning: STATUS_COLOURS.warning.h,
} as const satisfies Record<string, number>

/**
 * How far an accent must stay from a status colour, measured in Oklab.
 *
 * **This used to be thirty degrees of hue, and that measured the wrong thing.** An angle
 * compares an accent against three targets on a scale that means something different for
 * each of them, because `--warning` is light and weak while `--danger` is dark and
 * strong: across the hues the angle rule accepted, the real perceptual distance to the
 * nearest status colour ranged from 0.095 to 0.290 — a threefold spread presented as one
 * bar. Two consequences were measurable. A hue identical to `--warning` sat at 0.102 and
 * was refused for its angle rather than its likeness; and hue 125 passed at exactly
 * thirty degrees while sitting 0.095 from `--success` — the tightest pair the old rule
 * allowed, and the one that collapses onto `--danger` under deuteranopia, which is eight
 * per cent of men in a room of two hundred.
 *
 * 0.11 is the floor, chosen against the catalogue rather than picked round: it refuses
 * hue 125 and its mirror at 185, refuses a hue wearing `--warning`'s own angle, and
 * leaves every curated accent standing with about a tenth of margin — teal at 0.120 is
 * the tightest of the four, not rose. A ring-1 test asserts the catalogue passes, so
 * moving a status token breaks the build rather than a host's save.
 *
 * What it still does not model is colour-vision deficiency directly. Refusing the
 * tightest normal-vision pairs removes the collapse this product can actually produce,
 * but a simulation is the honest version and is not built. Section 8's rule — colour is
 * never the sole carrier — is what carries the remainder, and `WallNotice` and `Badge`
 * both keep an icon and a word for exactly that reason.
 */
const MIN_STATUS_DISTANCE = 0.11

const HUE_RANGE = { min: 0, max: 359 } as const

/** A font pairing. See `tokens.css` for what each one resolves to. */
export const THEME_FONTS = ['sans', 'serif'] as const
export type ThemeFonts = (typeof THEME_FONTS)[number]

/** How the wall frames a photo in the layouts that draw a frame at all. */
export const THEME_FRAMES = ['soft', 'square', 'round'] as const
export type ThemeFrame = (typeof THEME_FRAMES)[number]

/**
 * What the event's panes are made of — roadmap 11.5.
 *
 * `glass` is the liquid-glass material of docs/DESIGN-SYSTEM.md §13 and what every event
 * renders today; `plain` is the opaque tier the same section already ships, which is
 * `--surface-raised` — the panel this product draws on every non-glass surface. So this
 * field chooses between two renderings that both already exist and have both already been
 * reviewed; it is not a second look.
 *
 * **A closed set and not a boolean, because it names a material.** `fonts` names a face and
 * `frame` names a corner; a third field spelled `glassEnabled: true` would be the one entry
 * in a theme that describes a switch rather than a thing.
 */
export const THEME_MATERIALS = ['glass', 'plain'] as const
export type ThemeMaterial = (typeof THEME_MATERIALS)[number]

export interface EventThemeProps {
  /** Degrees on the oklch hue circle, 0-359. */
  readonly accentHue: number
  readonly fonts: ThemeFonts
  readonly frame: ThemeFrame
  /**
   * Whether this event wears the glass material at all.
   *
   * The host's answer, and one of three that now have a say. The other two belong to the
   * machine — the browser's own capability and stated preferences, and the runtime frame
   * and interaction budget of roadmap 11.3 — and `web/src/design-system/glass.ts` holds the
   * precedence between them: **every answer may take the material away and none may give it
   * back.** A host who asks for glass on a projector, or on a phone that has stopped coping,
   * still gets the opaque tier.
   *
   * It belongs to the event rather than to the device because it is an aesthetic decision
   * about one evening — two phones in the same room should not disagree about how the
   * product looks — and the device already has three answers of its own about what it can
   * afford.
   */
  readonly material: ThemeMaterial
}

/**
 * The theme an event has when nobody chose one, and what every event rendered before
 * this feature existed.
 *
 * `305` is the hue `tokens.css` already declares, `sans` is the system stack it already
 * resolves to, `soft` is the radius the wall already draws, `glass` is the material every
 * pane already wears — so a default theme is not a theme at all: the
 * surfaces emit no override for it and the DOM is byte for byte what it was.
 */
// Frozen because it is genuinely shared: `EventSettings.default()` copies its props
// shallowly, so every unthemed event on the box holds this one object. That sharing is
// free once nothing can write to it, and a `readonly` type alone is a compile-time
// promise that a cast or a plain-JS caller can walk straight past.
export const DEFAULT_EVENT_THEME: EventThemeProps = Object.freeze({
  accentHue: 305,
  fonts: 'sans',
  frame: 'soft',
  material: 'glass',
})

/**
 * The hues the host's picker offers, by name.
 *
 * **The list is an affordance; the rule is the guard.** An arbitrary colour picker is
 * what makes unreadable walls and a support queue, so the console offers four named
 * hues and nothing else — two of them are the roadmap's own examples, a wedding pink and
 * a corporate blue. But the API takes an angle and `createEventTheme` will accept any
 * angle it can prove legible, because the rule is what makes a palette safe and a future
 * custom-colour field must not have to re-derive it. Every hue here passes the rule;
 * `eventTheme.test.ts` asserts that rather than trusting it.
 *
 * Mirrored in `web/src/design-system/eventTheme.ts` for the picker, and pinned there by
 * `eventThemeContract.test.ts`.
 */
export const CURATED_ACCENT_HUES = {
  /** The product's own accent, and therefore the default. */
  violet: 305,
  /** The wedding. Chroma is fixed by the design system, so it is a rose rather than the
   *  roadmap's literal "dusty" pink — a dusty one would mean a second chroma, which is
   *  the freedom that makes palettes fail. */
  rose: 345,
  /** The corporate launch. */
  azure: 250,
  /** The one cool hue that is neither the blue nor `--success`. */
  teal: 195,
} as const satisfies Record<string, number>

/** The three colours a hue produces, as the browser will compute them. */
export interface AccentPalette {
  readonly hue: number
  readonly accent: Oklch
  readonly strong: Oklch
  readonly ink: Oklch
}

const at = (tone: Tone, hue: number): Oklch => ({ l: tone.l, c: tone.c, h: hue })

/** What `tokens.css` will render for this hue, computed the same way the browser will. */
export const accentPalette = (hue: number): AccentPalette => ({
  hue,
  accent: at(ACCENT_TONE, hue),
  strong: at(ACCENT_STRONG_TONE, hue),
  ink: at(ACCENT_INK_TONE, hue),
})

const round = (ratio: number): number => Math.round(ratio * 100) / 100

/** How close this accent comes to a status colour, and which one it crowds. */
const nearestStatus = (accent: Oklch): { role: string; distance: number } => {
  const measured = Object.entries(STATUS_COLOURS).map(([role, colour]) => ({
    role,
    distance: oklabDistance(accent, colour),
  }))
  return measured.reduce((closest, next) => (next.distance < closest.distance ? next : closest))
}

/** The nearest status colour this accent crowds, or `null` when it crowds none. */
const statusClash = (accent: Oklch): DomainError | null => {
  const { role, distance } = nearestStatus(accent)
  if (distance >= MIN_STATUS_DISTANCE) return null

  return DomainError.invalid('eventTheme.accentTooCloseToStatus', {
    hue: accent.h,
    conflictsWith: role,
    // Three decimals, not two: the whole scale lives between 0.04 and 0.29, and a host
    // reading `0.1` against a minimum of `0.11` learns nothing from a rounded number.
    separation: Math.round(distance * 1000) / 1000,
    minimum: MIN_STATUS_DISTANCE,
  })
}

/**
 * The legibility rule, over a palette rather than over a hue.
 *
 * Exported, and taking the palette rather than the angle, for one reason: no hue this
 * product can produce fails the two contrast checks — the lightness and chroma are fixed
 * and the ratio holds all the way round the circle, bottoming out at 7.01:1. A rule
 * whose failure path cannot be reached from its own caller is a rule nobody has tested,
 * so the seam is here, and `eventTheme.test.ts` drives it with palettes the derivation
 * would never build. That is also what makes this the guard on the *derivation*: move
 * `ACCENT_TONE` and one of these checks starts failing, which is exactly the edit — "I
 * nudged a lightness so one screen looked better" — that section 8 says is how contrast
 * regresses.
 */
export const accentFailure = (palette: AccentPalette): DomainError | null => {
  const onAccent = contrastRatio(palette.ink, palette.accent)
  if (onAccent < INK_ON_ACCENT_MIN) {
    return DomainError.invalid('eventTheme.accentUnreadable', {
      on: 'accent',
      measured: round(onAccent),
      required: INK_ON_ACCENT_MIN,
    })
  }

  const onStrong = contrastRatio(palette.ink, palette.strong)
  if (onStrong < INK_ON_ACCENT_STRONG_MIN) {
    return DomainError.invalid('eventTheme.accentUnreadable', {
      on: 'accent-strong',
      measured: round(onStrong),
      required: INK_ON_ACCENT_STRONG_MIN,
    })
  }

  return statusClash(palette.accent)
}

/** Narrows a value read back from the `settings` JSON column or from a form. */
export const isThemeFonts = (value: unknown): value is ThemeFonts =>
  typeof value === 'string' && (THEME_FONTS as readonly string[]).includes(value)

export const isThemeFrame = (value: unknown): value is ThemeFrame =>
  typeof value === 'string' && (THEME_FRAMES as readonly string[]).includes(value)

export const isThemeMaterial = (value: unknown): value is ThemeMaterial =>
  typeof value === 'string' && (THEME_MATERIALS as readonly string[]).includes(value)

/** Is this a point on the hue circle at all — a question of shape, not of taste. */
const shapeFailure = ({ accentHue }: EventThemeProps): DomainError | null =>
  Number.isInteger(accentHue) && accentHue >= HUE_RANGE.min && accentHue <= HUE_RANGE.max
    ? null
    : DomainError.invalid('eventTheme.accentHueInvalid', HUE_RANGE)

/**
 * Validate a theme a host is **choosing**.
 *
 * Shape first, then the legibility rule. The font pairing, the frame style and the material
 * are closed sets that the type system and the boundary's zod schema already narrow, so
 * nothing is re-checked for them — there is no failure they can have.
 *
 * **The material is not part of the legibility rule, and that is a finding rather than an
 * omission.** Turning the material off replaces a tint at 0.92–0.95 alpha with the same
 * colour at 1.0, so every ink on a pane gains contrast rather than losing it: the opaque
 * tier is the *better* ground of the two, and §13 derives both translucent floors by asking
 * how close they come to it. There is no hue, no pairing and no frame whose legibility the
 * material can decide, so a rule here would be a check that cannot fail — which is the kind
 * this file already refuses to write.
 */
export const createEventTheme = (props: EventThemeProps): Result<EventThemeProps, DomainError> => {
  const failure = shapeFailure(props) ?? accentFailure(accentPalette(props.accentHue))
  return failure === null ? ok(props) : err(failure)
}

/**
 * Validate a theme that is **already stored**, which is a different question.
 *
 * **Nothing here can refuse.** A theme is cosmetic, and no cosmetic field is allowed to
 * take an event off the air: a hue that is not a point on the circle falls back to the
 * default and the event renders in violet, rather than throwing `corrupt` out of
 * `findById` and failing the wall, the join *and* the settings page — the exact outage
 * the paragraph below exists to prevent, one bucket over. A value that shape-fails was
 * written by something other than this product, so there is no host choice to lose.
 *
 * `MIN_STATUS_DISTANCE`, the tones and the status colours are all numbers somebody will
 * one day tighten, and every one of them is judged against a *choice a host already
 * made*. Re-running the rule on read means that edit turns valid stored themes into a
 * corrupt row: `findById` throws, and the wall, the join and the settings page all fail
 * for that event — including the page the host would have used to pick another colour.
 * A rule tightened on Tuesday must not take somebody's Saturday wedding off the screen.
 *
 * So a refusal reaches a host at the moment they choose, and never at the moment the
 * server reads. The cost is bounded and visible: an event may keep rendering a palette
 * the product would no longer offer, until its host picks again.
 */
export const restoreEventTheme = (props: EventThemeProps): Result<EventThemeProps, DomainError> =>
  shapeFailure(props) === null ? ok(props) : ok(DEFAULT_EVENT_THEME)

/** Exposed so the zod schema at the boundary states the same bounds instead of drifting. */
export const accentHueRange = HUE_RANGE
