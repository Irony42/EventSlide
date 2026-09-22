import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { wallBudgetProps } from '../../design-system/budget'
import { readEventTheme, themeSurfaceProps } from '../../design-system/eventTheme'
import { Button } from '../../design-system/components/Button'
import { Dialog } from '../../design-system/components/Dialog'
import { Spinner } from '../../design-system/components/Spinner'
import { StatusIcon, type StatusTone } from '../../design-system/components/StatusIcon'
import type { WallItemDto, WallLayout } from '../../lib/api/dto'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { messageForCode } from '../../lib/i18n/translations'
import { ReactionBurst } from './components/ReactionBurst'
import { WallEmptyState } from './components/WallEmptyState'
import { WallLayouts } from './components/WallLayouts'
import { WallOverlay } from './components/WallOverlay'
import { useFrameBudget } from './hooks/useFrameBudget'
import { useLayoutParam } from './hooks/useLayoutParam'
import { useSlideshow } from './hooks/useSlideshow'
import { useTimingOverrides } from './hooks/useTimingOverrides'
import { useWallKeyboard } from './hooks/useWallKeyboard'
import { useWallPlaylist } from './hooks/useWallPlaylist'
import styles from './WallPage.module.css'

/** One frozen array, so an empty playlist keeps a stable identity between renders. */
const NO_ITEMS: readonly WallItemDto[] = []

/**
 * What the `L` key walks through: every layout this build renders.
 *
 * Where a wall starts arrives in the wall response — the domain's default, since no
 * layout is persisted per event. This is the on-the-spot change for somebody standing
 * at the projector who wants the room to see more photos at once during the cocktail
 * hour, and `?layout=` on the display URL is the same change made in advance, for a
 * projector nobody is standing at.
 *
 * The order is the two layouts 2.0 shipped, then the four 2.3 added. It is not sorted by
 * anything — by slot count it would read 1, 6, 3, 5, 12, 2 — and the reason it is not is
 * that the first press has always landed on the mosaic, in every host's hands and in the
 * visual suite. Re-sorting the cycle to make a comment true would move that for no gain.
 * The help dialog reads the order off this array, so a layout added here cannot fall out
 * of the copy that names it.
 */
const LAYOUT_CYCLE: readonly WallLayout[] = [
  'spotlight',
  'mosaic',
  'polaroid',
  'filmstrip',
  'collage',
  'split',
]

/** The French names of the cycle, in cycle order. Built once; nothing here changes. */
const LAYOUT_ORDER_HINT = fr.wall.layoutOrder(LAYOUT_CYCLE.map((name) => fr.wall.layoutNames[name]))

const nextLayout = (current: WallLayout): WallLayout => {
  const at = LAYOUT_CYCLE.indexOf(current)
  return LAYOUT_CYCLE[(at + 1) % LAYOUT_CYCLE.length] ?? current
}

/**
 * Joins class names.
 *
 * A CSS Module is typed as an index signature, so every class is `string | undefined`,
 * and a primitive that declares `className?: string` refuses the `undefined` half.
 */
const classes = (...parts: readonly (string | false | undefined)[]): string =>
  parts.filter(Boolean).join(' ')

interface WallNoticeProps {
  readonly tone: StatusTone
  readonly text: string
  /** Hold the notice back, so a two-second network blip never reaches the room. */
  readonly delayed?: boolean
}

/**
 * A status pill, at the projector's type scale.
 *
 * `Badge` is the primitive for this shape, and it is sized for the host's laptop
 * (`--text-xs`): nothing below `--text-xl` is readable at five metres. It keeps
 * `StatusIcon` and a word next to the colour, so the signal survives a colourblind
 * viewer and a washed-out projector lamp.
 */
function WallNotice({ tone, text, delayed = false }: WallNoticeProps) {
  return (
    <p className={classes(styles['notice'], styles[tone], delayed && styles['delayed'])}>
      <StatusIcon tone={tone} className={classes(styles['noticeIcon'])} />
      {text}
    </p>
  )
}

const toggleFullscreen = (): void => {
  const root = document.documentElement

  if (document.fullscreenElement == null) {
    // A projector browser may refuse without a gesture, or not implement it at all.
    // Neither is worth taking the wall down for.
    if (typeof root.requestFullscreen !== 'function') return
    void root.requestFullscreen().catch(() => undefined)
    return
  }

  if (typeof document.exitFullscreen !== 'function') return
  void document.exitFullscreen().catch(() => undefined)
}

/**
 * The projected wall.
 *
 * Full-bleed and fixed, so the photo reaches the physical edge while every piece of
 * text stays inside the 4% overscan inset. It composes and owns no rules: the interval,
 * the Ken Burns duration and the playlist window are all decisions the server has
 * already made. The layout is the one thing this screen decides for itself — from its
 * own URL, or from the host's `L` key — because it is what the room looks like and not
 * what the event is.
 *
 * The states in order of how often a room actually sees them: empty (the first twenty
 * minutes of the party, and the whole of a well-moderated evening's start), populated,
 * offline-but-playing, and only then loading and failed. 1.0 shipped the last two as a
 * black screen, which is why every host reloaded the page.
 */
export function WallPage() {
  const { slug } = useParams()
  const eventSlug = slug ?? ''

  const { wall, loading, error, offline, reactionPulse, refresh } = useWallPlaylist(eventSlug)
  const { transitionMs } = useTimingOverrides()
  const urlLayout = useLayoutParam()
  const budget = useFrameBudget()

  const items = wall?.items ?? NO_ITEMS
  const slideshow = useSlideshow({ items, intervalMs: wall?.slideIntervalMs ?? 0 })

  /**
   * Three sources, in the order a room means them: the key somebody just pressed, then
   * the display URL the projector was launched on, then the layout the wall response
   * carries. Derived rather than seeded into the state, so `L` is still the only thing
   * that writes here and there is no copy of the URL to fall out of date.
   */
  const [layoutOverride, setLayoutOverride] = useState<WallLayout | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [joinCardDismissed, setJoinCardDismissed] = useState(false)

  const serverLayout = wall?.layout
  const closeHelp = useCallback(() => setHelpOpen(false), [])

  /**
   * What the room is looking at, named on the wall element itself.
   *
   * The layout is chosen in three places and stored in none of them, so without this
   * there is nothing outside React that can answer "which layout is this projector
   * showing" — and that is the question a second projector is compared on, and the one a
   * wall that quietly fell back to the spotlight answers wrongly.
   */
  const layout = layoutOverride ?? urlLayout ?? serverLayout ?? null

  useWallKeyboard({
    onTogglePause: () => (slideshow.paused ? slideshow.resume() : slideshow.pause()),
    onStep: (step) => slideshow.advance(step),
    onToggleFullscreen: toggleFullscreen,
    onCycleLayout: () =>
      setLayoutOverride((current) =>
        nextLayout(current ?? urlLayout ?? serverLayout ?? 'spotlight'),
      ),
    onToggleHelp: () => setHelpOpen((open) => !open),
    onDismiss: () => {
      // One key, the obvious meaning: put away whatever is covering the photos.
      if (helpOpen) {
        setHelpOpen(false)
        return
      }
      setJoinCardDismissed(true)
    },
  })

  /**
   * The invitation, or nothing — never half of it.
   *
   * The code and the link arrive together from one presenter, so there is no deployment in
   * which the server sends one and not the other. Requiring both here is what keeps the
   * browser from inventing the missing half from `window.location.origin`: that is the
   * address this projector was opened on rather than the one a guest's phone can reach,
   * and printing it inside a QR is trap 1 with a different mismatch.
   */
  const join =
    wall?.joinCode !== undefined && wall.joinUrl !== undefined
      ? { code: wall.joinCode, url: wall.joinUrl }
      : null
  const showsOverlay = join !== null && !joinCardDismissed && items.length > 0

  /**
   * The event's own look, worn by the element that renders it (roadmap 2.2).
   *
   * Not a `:root` write from an effect, which would land after React had already produced
   * a frame and make the projector blink the product's violet before the host's rose on
   * every reload. Here the attributes and the photos they theme are one render, so there
   * is no frame in between to be wrong — and before the response arrives there is nothing
   * accent-coloured on screen at all: the loading state is a `--text-primary` spinner on
   * `--surface-base`, neither of which a theme touches.
   *
   * Empty for an event that chose nothing, so an unthemed wall renders the DOM the
   * committed baselines were taken from.
   */
  // Narrowed rather than trusted, exactly as the guest path narrows a stored session:
  // the projector runs unattended, and a hue the wire says is 4000 makes
  // `oklch(72% 0.17 var(--accent-hue))` invalid at computed-value time, which strips the
  // colour from every `--accent` consumer on the wall rather than failing loudly.
  const theme = themeSurfaceProps(readEventTheme(wall?.theme ?? null), 'wall')

  return (
    <div
      {...theme}
      // What this machine has turned out not to be able to afford — roadmap 11.3.
      //
      // The room starts having already given up the blur, which is `glass.ts`'s decision and
      // needs no measurement. Everything below that rung is a verdict taken here, on the
      // night, by the wall watching its own frames: `budget.ts` holds the order and
      // `useFrameBudget` holds the loop. It is an attribute on the root for the reason the
      // glass tier is one on the shell — custom properties and descendant selectors reach
      // everything inside in the same paint, and no component below learns that a budget
      // exists. A wall that is coping spreads nothing at all.
      {...wallBudgetProps(budget)}
      className={styles['wall']}
      data-wall-layout={layout ?? undefined}
      // The bottom-right corner is spoken for while the invitation is up, and a layout
      // that would otherwise centre a caption under it lays out inside what is left.
      // The card is chrome and the caption is the guest's words, so the card is what the
      // wall reserves around rather than what it prints over.
      data-wall-chrome={showsOverlay ? 'corner' : undefined}
    >
      {/* One region for the whole concern, mounted once — never one per notice. */}
      <div className={styles['notices']} aria-live="polite">
        {offline ? <WallNotice tone="warning" text={fr.wall.offline} delayed /> : null}
        {slideshow.paused ? <WallNotice tone="accent" text={fr.wall.paused} /> : null}
      </div>

      {wall === null ? (
        <div className={styles['centre']}>
          {loading ? (
            <Spinner size="lg" label={fr.app.loading} />
          ) : (
            <div className={styles['failure']} role="alert">
              <StatusIcon tone="danger" className={classes(styles['failureIcon'])} />
              <h1 className={styles['failureTitle']}>
                {error instanceof ApiError ? messageForCode(error.code, fr) : fr.wall.errorTitle}
              </h1>
              <p className={styles['failureHint']}>{fr.wall.errorHint}</p>
              {/* The wall retries on its own; this is for the host who walked over
                  rather than waiting for the next attempt. */}
              <Button size="lg" onClick={refresh}>
                {fr.app.retry}
              </Button>
            </div>
          )}
        </div>
      ) : items.length === 0 ? (
        <WallEmptyState eventName={wall.event.name} join={join} />
      ) : (
        <WallLayouts
          layout={layout ?? wall.layout}
          items={items}
          slideshow={slideshow}
          kenBurnsDurationMs={wall.kenBurnsDurationMs}
          transitionMs={transitionMs}
        />
      )}

      {showsOverlay && join !== null ? (
        <WallOverlay join={join} onDismiss={() => setJoinCardDismissed(true)} />
      ) : null}

      <ReactionBurst pulse={reactionPulse} />

      <Dialog
        open={helpOpen}
        title={fr.wall.shortcuts}
        // Six layouts is more than a host can hold in their head at a projector, so the
        // one screen that explains `L` names what it walks through.
        description={`${fr.wall.shortcutsHint} ${LAYOUT_ORDER_HINT}`}
        onClose={closeHelp}
      />
    </div>
  )
}
