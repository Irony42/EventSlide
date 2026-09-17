import type { CSSProperties } from 'react'
import type { EventThemeDto, ThemeFonts, ThemeFrame } from '../lib/api/dto'

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

export const isThemeFonts = (value: string): value is ThemeFonts =>
  (THEME_FONTS as readonly string[]).includes(value)

export const isThemeFrame = (value: string): value is ThemeFrame =>
  (THEME_FRAMES as readonly string[]).includes(value)

/** The name of a hue, when it is one of the four. `null` for an angle set over the API. */
export const accentNameFor = (hue: number): CuratedAccent | null =>
  CURATED_ACCENT_NAMES.find((name) => CURATED_ACCENT_HUES[name] === hue) ?? null

type AccentStyle = CSSProperties & { readonly '--accent-hue': string }

/**
 * What a themed surface spreads onto its own root element.
 *
 * Every key is optional and absent rather than `undefined`, because
 * `exactOptionalPropertyTypes` makes those different things and because an attribute
 * rendered as `data-event-frame="soft"` would be a DOM difference on an event that chose
 * nothing.
 */
export interface ThemeSurfaceProps {
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
}

/**
 * Which surface is asking, because they do not wear the same parts of a theme.
 *
 * `wall` takes all three. `guest` takes the accent only: a phone has no photo frames to
 * style, and a display face is a choice about `--text-display` on a projector — on a
 * screen whose largest type is `--text-lg` it buys nothing. The pairings cost zero bytes
 * because they are built from system faces (DESIGN-SYSTEM.md §12); had they been bundled
 * instead, this is the surface that would have paid for them.
 */
export type ThemedSurface = 'wall' | 'guest'

export const themeSurfaceProps = (
  theme: EventThemeDto | null,
  surface: ThemedSurface,
): ThemeSurfaceProps => {
  if (theme === null) return {}

  const accent: ThemeSurfaceProps =
    theme.accentHue === DEFAULT_EVENT_THEME.accentHue
      ? {}
      : {
          style: { '--accent-hue': String(theme.accentHue) },
          'data-event-accent': String(theme.accentHue),
        }

  if (surface === 'guest') return accent

  return {
    ...accent,
    ...(theme.fonts === DEFAULT_EVENT_THEME.fonts ? {} : { 'data-event-fonts': theme.fonts }),
    ...(theme.frame === DEFAULT_EVENT_THEME.frame ? {} : { 'data-event-frame': theme.frame }),
  }
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

  return { accentHue: hue, fonts, frame }
}
