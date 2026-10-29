import type { CSSProperties } from 'react'
import type {
  EventThemeDto,
  ThemeAmbiance,
  ThemeCustom,
  ThemeFaces,
  ThemeFonts,
  ThemeFrame,
  ThemeGround,
  ThemeMaterial,
} from '../lib/api/dto'
import { glassMaterialProps, type GlassMaterialProps } from './glass'

/**
 * How an event's theme reaches the screen (roadmap 2.2).
 *
 * The rule that decides whether a theme is allowed is server-side, in
 * `src/domain/events/eventTheme.ts` — this file only knows how to wear one. It holds no
 * colour: the accent arrives as an **angle** and `tokens.css` turns it into a palette,
 * which is what keeps the design system's "raw values live in one file" rule intact
 * while still letting every event look like itself.
 *
 * ## Why these go on a surface element and not on `:root`
 *
 * Two reasons, and both are about a defect somebody would notice.
 *
 * 1. **The host's console is not themed.** It is one operator's tool across many events,
 *    and a moderation queue that changes colour per event is the screen where
 *    consistency beats personality — `--success` and `--danger` there are a working
 *    vocabulary, not decoration. A `:root` override cannot say "these two surfaces and
 *    not that one".
 * 2. **A projector must not blink.** Writing `:root` from an effect is a second mutation
 *    that lands after React has already produced a frame, so the wall would paint in the
 *    product's violet and then repaint in the host's rose on every reload — for eight
 *    hours, in front of two hundred people. Returned as props instead, the theme and the
 *    content it themes are one render and one paint. Nothing is imperative, nothing has
 *    to be undone on unmount, and no surface can inherit the theme of the event it
 *    navigated away from.
 *
 * The default theme returns **nothing at all** rather than the default values: an event
 * nobody themed renders the DOM it rendered before this feature existed, which is what
 * every committed wall baseline photographs.
 */

/**
 * Mirrors `DEFAULT_EVENT_THEME` in the domain; pinned by `eventThemeContract.test.ts`.
 *
 * Frozen for the same reason its domain twin is: it is handed out by reference — from
 * `guestSession.withThemeDefault` and from both builders in `renderWithProviders` — so
 * every unthemed surface in the app holds this one object, and a `readonly` type alone
 * is a compile-time promise a cast or a plain-JS caller walks straight past.
 */
export const DEFAULT_EVENT_THEME: EventThemeDto = Object.freeze({
  accentHue: 305,
  fonts: 'sans',
  frame: 'soft',
  material: 'glass',
  ambiance: 'eventslide',
})

/**
 * The hues the host's picker offers, by name.
 *
 * A constrained choice rather than a colour wheel: an arbitrary picker is what produces
 * unreadable walls and a support queue, and four named hues is a decision a host can make
 * in two seconds. The server will accept any angle it can prove legible — the list is the
 * affordance, the rule is the guard — so this is a UI catalogue and not a whitelist.
 *
 * Mirrors `CURATED_ACCENT_HUES` in the domain; pinned by `eventThemeContract.test.ts`.
 * The French labels live in `lib/i18n/fr.ts`, keyed by these names.
 */
export const CURATED_ACCENT_HUES = {
  violet: 305,
  rose: 345,
  azure: 250,
  teal: 195,
} as const

export type CuratedAccent = keyof typeof CURATED_ACCENT_HUES

export const CURATED_ACCENT_NAMES = Object.keys(CURATED_ACCENT_HUES) as readonly CuratedAccent[]

/**
 * The two closed vocabularies, in the order the picker offers them.
 *
 * Here rather than read off the French labels in `lib/i18n/`: a copy table decides
 * *wording*, and a vocabulary the server validates against is not wording. Deriving the
 * options from `Object.keys(fr.admin.…)` would also make a reorganisation of that file —
 * which is happening on another branch — silently reorder or drop a control.
 *
 * Mirrors `THEME_FONTS` and `THEME_FRAMES` in the domain; pinned by
 * `eventThemeContract.test.ts`, so an option the server would refuse cannot reach a form.
 */
export const THEME_FONTS: readonly ThemeFonts[] = ['sans', 'serif']
export const THEME_FRAMES: readonly ThemeFrame[] = ['soft', 'square', 'round']
export const THEME_MATERIALS: readonly ThemeMaterial[] = ['glass', 'plain']
export const THEME_AMBIANCES: readonly ThemeAmbiance[] = [
  'eventslide',
  'guinguette',
  'riviera',
  'champs',
  'bivouac',
  'cabaret',
  'noces',
  'custom',
]
export const THEME_FACES: readonly ThemeFaces[] = [
  'eventslide',
  'guinguette',
  'riviera',
  'champs',
  'bivouac',
  'cabaret',
  'noces',
]
export const THEME_GROUNDS: readonly ThemeGround[] = ['light', 'dark']

/**
 * The only shape a venue photograph's URL may have: a path under this origin that names a
 * digest. Checked on the way in rather than trusted, because a theme is also read back from
 * `sessionStorage`, and whatever passes this is written into a CSS `url()`.
 */
const VENUE_GROUND_PATH = /^\/api\/events\/[a-z0-9-]{2,64}\/venue-photo\/[0-9a-f]{64}$/

export const isVenueGroundUrl = (value: unknown): value is string =>
  typeof value === 'string' && VENUE_GROUND_PATH.test(value)

/** `url("…")` with the path quoted as JSON, which is a valid CSS string for this alphabet. */
const cssUrl = (path: string): string => `url(${JSON.stringify(path)})`

/**
 * What a surface (or the marker) carries to show the host's own ground: the photograph as an
 * inline custom property, and the attribute `tokens.css` and `base.css` key on.
 *
 * **Inline, and on the element that is dressed.** The value is computed (a URL the server minted),
 * so it is the one kind of thing an inline style is for; the colours of the grade that keeps text
 * legible over it stay in `tokens.css`. Because it travels with the element in the same render,
 * the ground and the page it sits behind are one paint: nothing is applied from an effect, so
 * there is no frame in which the bundled photograph shows first.
 *
 * Every ambiance paints a ground, the root look included (which carries no
 * `data-event-ambiance`), so this needs nothing of the ambiance: the server sends a URL only for a
 * photograph it holds, and the client takes it only if it is a path this product mints.
 */
export interface VenueGroundProps {
  readonly style: CSSProperties & { readonly '--ambiance-ground': string }
  readonly 'data-venue-ground': ThemedSurface
}

export const venueGroundProps = (
  theme: { readonly groundUrl?: string | null | undefined } | null,
  surface: ThemedSurface,
): VenueGroundProps | null => {
  if (theme === null) return null
  if (!isVenueGroundUrl(theme.groundUrl)) return null
  return {
    style: { '--ambiance-ground': cssUrl(theme.groundUrl) },
    'data-venue-ground': surface,
  }
}

export const isThemeFaces = (value: unknown): value is ThemeFaces =>
  typeof value === 'string' && (THEME_FACES as readonly string[]).includes(value)

export const isThemeGround = (value: unknown): value is ThemeGround =>
  typeof value === 'string' && (THEME_GROUNDS as readonly string[]).includes(value)

/**
 * What a custom ambiance carries (ADR 0011): the polarity and the faces to borrow as attributes
 * `tokens.css` selects on, and the ground's tint as an inline **angle**, the one kind of custom
 * property JavaScript may set (`--accent-hue`'s sibling). `null` for any other ambiance or while
 * the object is missing: a theme that says `custom` without it is shown as the product's own.
 */
export interface CustomGroundProps {
  readonly style: CSSProperties & { readonly '--ground-hue': string }
  readonly 'data-ambiance-ground': ThemeGround
  readonly 'data-ambiance-faces': ThemeFaces
}

export const customGroundProps = (
  ambiance: ThemeAmbiance | null | undefined,
  custom: ThemeCustom | null | undefined,
): CustomGroundProps | null => {
  if (ambiance !== 'custom' || custom === null || custom === undefined) return null
  return {
    style: { '--ground-hue': `${custom.groundHue}deg` },
    'data-ambiance-ground': custom.ground,
    'data-ambiance-faces': custom.faces,
  }
}

export const isThemeFonts = (value: string): value is ThemeFonts =>
  (THEME_FONTS as readonly string[]).includes(value)

export const isThemeFrame = (value: string): value is ThemeFrame =>
  (THEME_FRAMES as readonly string[]).includes(value)

export const isThemeMaterial = (value: string): value is ThemeMaterial =>
  (THEME_MATERIALS as readonly string[]).includes(value)

export const isThemeAmbiance = (value: string): value is ThemeAmbiance =>
  (THEME_AMBIANCES as readonly string[]).includes(value)

/** The name of a hue, when it is one of the four. `null` for an angle set over the API. */
export const accentNameFor = (hue: number): CuratedAccent | null =>
  CURATED_ACCENT_NAMES.find((name) => CURATED_ACCENT_HUES[name] === hue) ?? null

type AccentStyle = CSSProperties & {
  readonly '--accent-hue'?: string
  readonly '--ground-hue'?: string
  readonly '--ambiance-ground'?: string
}

/**
 * What a themed surface spreads onto its own root element.
 *
 * Every key is optional and absent rather than `undefined`, because
 * `exactOptionalPropertyTypes` makes those different things and because an attribute
 * rendered as `data-event-frame="soft"` would be a DOM difference on an event that chose
 * nothing.
 */
export interface ThemeSurfaceProps extends GlassMaterialProps {
  readonly style?: AccentStyle
  /**
   * The marker `tokens.css` re-derives the accent on, carrying the hue as its value.
   *
   * It exists because of a CSS rule that is easy to get wrong: `--accent` references
   * `--accent-hue`, and a custom property that references another is resolved on the
   * element it is *declared* on — descendants inherit the substituted result. Moving
   * `--accent-hue` alone therefore changes nothing. The stylesheet re-declares the
   * derivation for `[data-event-accent]`, and this is what selects it.
   *
   * The value is the hue, which nothing reads but which makes the DOM say what it is
   * doing rather than carrying a bare empty attribute.
   */
  readonly 'data-event-accent'?: string
  readonly 'data-event-fonts'?: EventThemeDto['fonts']
  readonly 'data-event-frame'?: EventThemeDto['frame']
  /** The ambiance block `tokens.css` selects. Absent for the product's own, `eventslide`. */
  readonly 'data-event-ambiance'?: EventThemeDto['ambiance']
  /** A custom ambiance's polarity and borrowed faces; see {@link customGroundProps}. */
  readonly 'data-ambiance-ground'?: ThemeGround
  readonly 'data-ambiance-faces'?: ThemeFaces
  /** Present when the host's own photograph is the ground; see {@link venueGroundProps}. */
  readonly 'data-venue-ground'?: ThemedSurface
}

/**
 * Which surface is asking, because they do not wear the same parts of a theme.
 *
 * `wall` takes all of it. `guest` takes the accent and the material: a phone has no photo
 * frames to style, and a display face is a choice about `--text-display` on a projector —
 * on a screen whose largest type is `--text-lg` it buys nothing. The pairings cost zero
 * bytes because they are built from system faces (DESIGN-SYSTEM.md §12); had they been
 * bundled instead, this is the surface that would have paid for them.
 *
 * **The material follows the accent rather than the pairing, and the guest's phone is the
 * one screen where it is visible at all.** The two panes that wear the material today are
 * the guest's upload composer and the host's moderation toolbar, and the host's console is
 * not a themed surface — it is one operator's tool across many events, which is §12's
 * argument and does not change because the knob is a surface finish rather than a colour.
 * The wall takes it and renders nothing new: §13 already gave the material up there, on
 * every machine, which is the precedence rule at its floor rather than an exception to it.
 */
export type ThemedSurface = 'wall' | 'guest'

/**
 * `preview: true` is for a miniature drawn **inside a page that may wear another ambiance** (the
 * template picker, the settings page's two frames): it names the ambiance even when it is the
 * default, because `tokens.css` has an `eventslide` block for exactly that and a miniature that
 * emitted nothing would inherit whatever the page around it wears.
 */
export const themeSurfaceProps = (
  theme: EventThemeDto | null,
  surface: ThemedSurface,
  options: { readonly preview?: boolean } = {},
): ThemeSurfaceProps => {
  if (theme === null) return {}

  const accent: ThemeSurfaceProps =
    theme.accentHue === DEFAULT_EVENT_THEME.accentHue
      ? {}
      : {
          style: { '--accent-hue': String(theme.accentHue) },
          'data-event-accent': String(theme.accentHue),
        }

  // Never spelled out here: `glassMaterialProps` is the one place allowed to decide what a
  // surface below the shell may declare, and its return type is what stops this file
  // helpfully emitting the tier in full and putting a blur back on a machine that shed it.
  const material = glassMaterialProps(theme.material)
  // Both surfaces wear the ambiance: it is the world the guest's phone and the room share.
  const ambiance: ThemeSurfaceProps =
    theme.ambiance === DEFAULT_EVENT_THEME.ambiance && options.preview !== true
      ? {}
      : { 'data-event-ambiance': theme.ambiance }

  // Merged with the accent's style rather than beside it: both are inline custom properties on
  // the one element, and a second `style` key would silently replace the first.
  const venue = venueGroundProps(theme, surface)
  const custom = customGroundProps(theme.ambiance, theme.custom)
  const ground: ThemeSurfaceProps =
    venue === null && custom === null
      ? {}
      : {
          style: { ...accent.style, ...custom?.style, ...venue?.style },
          ...(venue === null ? {} : { 'data-venue-ground': venue['data-venue-ground'] }),
          ...(custom === null
            ? {}
            : {
                'data-ambiance-ground': custom['data-ambiance-ground'],
                'data-ambiance-faces': custom['data-ambiance-faces'],
              }),
        }

  if (surface === 'guest') return { ...accent, ...material, ...ambiance, ...ground }

  return {
    ...accent,
    ...material,
    ...ambiance,
    ...ground,
    ...(theme.fonts === DEFAULT_EVENT_THEME.fonts ? {} : { 'data-event-fonts': theme.fonts }),
    ...(theme.frame === DEFAULT_EVENT_THEME.frame ? {} : { 'data-event-frame': theme.frame }),
  }
}

/**
 * The material, for a theme that was written before there was one.
 *
 * Absent is the product's own material rather than a refusal — the same forgiveness
 * `guestSession.withThemeDefault` makes for a whole theme, one field down. An entry written
 * between roadmap 2.2 and 11.5 carries three keys, and the fourth's default is exactly what
 * that tab has been rendering, so filling it in changes nothing the guest sees and logs
 * nobody out of an upload screen mid-evening.
 *
 * A value that is **present and wrong** is still refused, and `null` says so rather than
 * defaulting: it would reach a CSS attribute selector, where a tier this build has never
 * heard of matches no block and renders the material the host may have turned off.
 */
const readThemeMaterial = (value: unknown): ThemeMaterial | null => {
  if (value === undefined) return DEFAULT_EVENT_THEME.material
  if (typeof value !== 'string' || !isThemeMaterial(value)) return null
  return value
}

/**
 * The ambiance, for a theme written before ambiances existed: absent is the product's own,
 * present and unknown is refused, exactly as for the material above. The one name this build
 * no longer ships, `darkroom`, is read as EventSlide, the dark slate it was.
 */
const readThemeAmbiance = (value: unknown): ThemeAmbiance | null => {
  if (value === undefined) return DEFAULT_EVENT_THEME.ambiance
  // A tab that stored its session while the Chambre noire existed holds `darkroom`: that look
  // is the product's own look again under another name (ADR 0010, amendment of 29/10), and
  // refusing the entry would log the guest out.
  const named = value === 'darkroom' ? 'eventslide' : value
  if (typeof named !== 'string' || !isThemeAmbiance(named)) return null
  return named
}

/**
 * The host's own ambiance (ADR 0011), read against the ambiance it belongs to. `undefined` is
 * "none"; an object that is present but malformed is `null`, like any other present-and-wrong
 * value; one sent with an ambiance that does not wear it is dropped rather than worn.
 */
const readThemeCustom = (
  value: unknown,
  ambiance: ThemeAmbiance,
): ThemeCustom | null | undefined => {
  if (ambiance !== 'custom') return undefined
  if (typeof value !== 'object' || value === null) return null
  const ground: unknown = Reflect.get(value, 'ground')
  const groundHue: unknown = Reflect.get(value, 'groundHue')
  const faces: unknown = Reflect.get(value, 'faces')
  if (!isThemeGround(ground) || !isThemeFaces(faces)) return null
  if (typeof groundHue !== 'number' || !Number.isInteger(groundHue)) return null
  if (groundHue < 0 || groundHue > 359) return null
  return { ground, groundHue, faces }
}

/**
 * Narrows a theme off the wire, or off a `sessionStorage` entry an older build wrote.
 *
 * `null` means "render the product's own look", which is also what the server sends for
 * an event nobody themed — so a client one deploy behind and an event one deploy old
 * reach the same screen by different routes.
 */
export const readEventTheme = (value: unknown): EventThemeDto | null => {
  if (typeof value !== 'object' || value === null) return null
  const hue: unknown = Reflect.get(value, 'accentHue')
  const fonts: unknown = Reflect.get(value, 'fonts')
  const frame: unknown = Reflect.get(value, 'frame')

  // The same bound the domain and the zod schema use. A stored entry is not a trusted
  // one — a hand-edited `accentHue` of 4000 would otherwise reach `--accent-hue` for
  // that guest, which is not a crash but is not a colour anybody chose either.
  if (typeof hue !== 'number' || !Number.isInteger(hue) || hue < 0 || hue > 359) return null
  if (typeof fonts !== 'string' || !isThemeFonts(fonts)) return null
  if (typeof frame !== 'string' || !isThemeFrame(frame)) return null

  const material = readThemeMaterial(Reflect.get(value, 'material'))
  if (material === null) return null

  const ambiance = readThemeAmbiance(Reflect.get(value, 'ambiance'))
  if (ambiance === null) return null

  // Present only when it is a path this product mints. Anything else is the bundled ground,
  // never a refusal: a photograph is a decoration, and a stored entry that carried an odd one
  // must not send a guest back to the join screen mid-evening.
  const custom = readThemeCustom(Reflect.get(value, 'custom'), ambiance)
  if (custom === null) return null

  const groundUrl: unknown = Reflect.get(value, 'groundUrl')
  return {
    accentHue: hue,
    fonts,
    frame,
    material,
    ambiance,
    ...(custom === undefined ? {} : { custom }),
    ...(isVenueGroundUrl(groundUrl) ? { groundUrl } : {}),
  }
}
