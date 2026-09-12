import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { Dialog } from '../../design-system/components/Dialog'
import { Spinner } from '../../design-system/components/Spinner'
import { StatusIcon, type StatusTone } from '../../design-system/components/StatusIcon'
import type { WallItemDto, WallLayout } from '../../lib/api/dto'
import { ApiError } from '../../lib/http'
import { fr, messageForCode } from '../../lib/i18n/fr'
import { ReactionBurst } from './components/ReactionBurst'
import { WallEmptyState } from './components/WallEmptyState'
import { WallLayouts } from './components/WallLayouts'
import { WallOverlay } from './components/WallOverlay'
import { useLayoutParam } from './hooks/useLayoutParam'
import { useSlideshow } from './hooks/useSlideshow'
import { useTimingOverrides } from './hooks/useTimingOverrides'
import { useWallKeyboard } from './hooks/useWallKeyboard'
import { useWallPlaylist } from './hooks/useWallPlaylist'
import styles from './WallPage.module.css'

/** One frozen array, so an empty playlist keeps a stable identity between renders. */
const NO_ITEMS: readonly WallItemDto[] = []

/**
 * What the `L` key walks through: the layouts this build actually renders.
 *
 * Where a wall starts arrives in the wall response — the domain's default, since no
 * layout is persisted per event. This is the on-the-spot change for somebody standing
 * at the projector who wants the room to see more photos at once during the cocktail
 * hour, and `?layout=` on the display URL is the same change made in advance, for a
 * projector nobody is standing at.
 */
const LAYOUT_CYCLE: readonly WallLayout[] = ['spotlight', 'mosaic']

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

  const joinCode = wall?.joinCode ?? null
  const showsOverlay = joinCode !== null && !joinCardDismissed && items.length > 0

  return (
    <div className={styles['wall']}>
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
                {error instanceof ApiError ? messageForCode(error.code) : fr.wall.errorTitle}
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
        <WallEmptyState eventName={wall.event.name} joinCode={joinCode} />
      ) : (
        <WallLayouts
          layout={layoutOverride ?? urlLayout ?? wall.layout}
          items={items}
          slideshow={slideshow}
          kenBurnsDurationMs={wall.kenBurnsDurationMs}
          transitionMs={transitionMs}
        />
      )}

      {showsOverlay && joinCode !== null ? (
        <WallOverlay joinCode={joinCode} onDismiss={() => setJoinCardDismissed(true)} />
      ) : null}

      <ReactionBurst pulse={reactionPulse} />

      <Dialog
        open={helpOpen}
        title={fr.wall.shortcuts}
        description={fr.wall.shortcutsHint}
        onClose={closeHelp}
      />
    </div>
  )
}
