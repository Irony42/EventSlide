import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { wallBudgetProps } from '../../design-system/budget'
import { cx } from '../../design-system/classNames'
import { readEventTheme, themeSurfaceProps } from '../../design-system/eventTheme'
import { useRootGroundHue } from '../../design-system/useRootGroundHue'
import { Button } from '../../design-system/components/Button'
import { Dialog } from '../../design-system/components/Dialog'
import { Spinner } from '../../design-system/components/Spinner'
import { StatusIcon, type StatusTone } from '../../design-system/components/StatusIcon'
import type { WallItemDto, WallLayout } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'
import { ApiError } from '../../lib/http'
import { useAnnounceLocale } from '../../lib/i18n/deferredLocale'
import { parseLocale } from '../../lib/i18n/locale'
import { messageForCode } from '../../lib/i18n/translations'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { AMBIANCE_LAYOUT } from './ambianceLayout'
import { ReactionBurst } from './components/ReactionBurst'
import { WallEmptyState } from './components/WallEmptyState'
import { WallLayouts } from './components/WallLayouts'
import { WallMissions } from './components/WallMissions'
import { WallOverlay } from './components/WallOverlay'
import { useFrameBudget } from './hooks/useFrameBudget'
import { useLayoutParam } from './hooks/useLayoutParam'
import { useIdleCursor } from './hooks/useIdleCursor'
import { useOutageStage } from './hooks/useOutageStage'
import { useSlideshow } from './hooks/useSlideshow'
import { useTimingOverrides } from './hooks/useTimingOverrides'
import { useWakeLock } from './hooks/useWakeLock'
import { useWallKeyboard } from './hooks/useWallKeyboard'
import { useWallPlaylist } from './hooks/useWallPlaylist'
import styles from './WallPage.module.css'

/**
 * How long a host's `Q` keeps the corner QR away.
 *
 * Nobody is at the projector to bring it back, and the QR is the one way a late guest gets in:
 * a hiding that outlived the host's attention would cost them their evening, so it undoes
 * itself (MUR-5).
 */
export const QR_HIDDEN_MS = 10 * 60_000

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
 * The order is the two layouts 2.0 shipped, then the four 2.3 added, then the clothesline.
 * It is not sorted by anything — by slot count it would read 1, 6, 3, 5, 12, 2, 5 — and the
 * reason it is not is that the first press has always landed on the mosaic, in every host's
 * hands and in the visual suite. Re-sorting the cycle to make a comment true would move that for no gain.
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
  'clothesline',
]

/**
 * The names of the cycle, in cycle order, in the language the room is in. Built per render
 * rather than at module load — six property reads and a join, on a dialog that opens only
 * when a host presses `?`.
 */
const layoutOrderHint = (text: UiText): string =>
  text.wall.layoutOrder(LAYOUT_CYCLE.map((name) => text.wall.layoutNames[name]))

const nextLayout = (current: WallLayout): WallLayout => {
  const at = LAYOUT_CYCLE.indexOf(current)
  return LAYOUT_CYCLE[(at + 1) % LAYOUT_CYCLE.length] ?? current
}

interface WallNoticeProps {
  readonly tone: StatusTone
  readonly text: string
}

/**
 * A status pill, at the projector's type scale.
 *
 * `Badge` is the primitive for this shape, and it is sized for the host's laptop
 * (`--text-xs`): nothing below `--text-xl` is readable at five metres. It keeps
 * `StatusIcon` and a word next to the colour, so the signal survives a colourblind
 * viewer and a washed-out projector lamp.
 */
function WallNotice({ tone, text }: WallNoticeProps) {
  return (
    <p className={cx(styles['notice'], styles[tone])}>
      <StatusIcon tone={tone} className={styles['noticeIcon']} />
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

  const { wall, loading, error, notServed, offline, reactionPulse, refresh } =
    useWallPlaylist(eventSlug)
  const text = useTranslations()
  const outage = useOutageStage(offline)
  const awake = useWakeLock()
  const cursorIdle = useIdleCursor()

  /**
   * The language the room is in, told to the shell above this page. It is the **event's**,
   * not this browser's — `src/domain/events/eventLanguage.ts` has the argument.
   *
   * `parseLocale` rather than a cast, as the stored guest preference is narrowed: this
   * crossed a network boundary, and a projector left open across a deploy that added a
   * sixth language must render the default rather than index a table with no entry. An
   * absent field takes the same path, which is what an older server sends. Both halves are
   * guarded in `router.test.tsx`, under "which language each surface speaks".
   *
   * Announced from an effect because it writes state in the component above. No flash to
   * pay for: nothing but a visually-hidden spinner label renders until this same response.
   */
  const announceLocale = useAnnounceLocale()
  const wallLocale = parseLocale(wall?.wallLanguage)

  useEffect(() => {
    if (wallLocale !== null) announceLocale(wallLocale)
  }, [wallLocale, announceLocale])

  const { transitionMs } = useTimingOverrides()
  const urlLayout = useLayoutParam()
  const budget = useFrameBudget()

  const items = wall?.items ?? NO_ITEMS
  const slideshow = useSlideshow({ items, intervalMs: wall?.slideIntervalMs ?? 0 })

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
  /**
   * Whether the room may still be invited — the server's answer, read from the domain's own
   * rule. Absent means an older server, which never said otherwise. Once the host has
   * closed the evening the wall keeps playing, but a QR on it leads to "not open"
   * (MUR-3), so neither the card, nor the code, nor the missions are drawn.
   */
  const acceptsGuests = wall?.acceptsGuests !== false
  const invitation = acceptsGuests ? join : null

  /**
   * Four sources, in the order a room means them: the key somebody just pressed, then
   * the display URL the projector was launched on, then the layout the event's ambiance
   * suggests (`ambianceLayout.ts`), then the layout the wall response carries. Derived
   * rather than seeded into the state, so `L` is still the only thing that writes here and
   * there is no copy of the URL to fall out of date.
   */
  const [layoutOverride, setLayoutOverride] = useState<WallLayout | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  /**
   * The corner QR, put away by the host: `Q`, or the card's own button.
   *
   * **Escape is not this.** It used to put away the QR and the missions with no way back, and
   * it is also the key the browser's own advice for leaving fullscreen points at, so a host
   * who pressed it twice while setting the projector up took the only door a late guest has
   * off the wall for the whole night (MUR-5). It closes the help now, and nothing more.
   *
   * It comes back on its own after `QR_HIDDEN_MS`: the projector is unattended, so a wrong
   * dismissal must not last until somebody reloads it.
   */
  const [qrHidden, setQrHidden] = useState(false)
  useEffect(() => {
    if (!qrHidden) return
    const timer = window.setTimeout(() => setQrHidden(false), QR_HIDDEN_MS)
    return () => window.clearTimeout(timer)
  }, [qrHidden])

  const serverLayout = wall?.layout

  /**
   * The event's own look, narrowed. Read once, here, because two things want it: the
   * surface that wears it below and the layout its ambiance suggests.
   */
  const eventTheme = readEventTheme(wall?.theme ?? null)
  const ambianceLayout = eventTheme === null ? null : AMBIANCE_LAYOUT[eventTheme.ambiance]
  useRootGroundHue(eventTheme?.ambiance, eventTheme?.custom)
  const closeHelp = useCallback(() => setHelpOpen(false), [])
  const showsOverlay = invitation !== null && !qrHidden && items.length > 0

  /**
   * What the room is looking at, named on the wall element itself.
   *
   * The layout is chosen in three places and stored in none of them, so without this
   * there is nothing outside React that can answer "which layout is this projector
   * showing" — and that is the question a second projector is compared on, and the one a
   * wall that quietly fell back to the spotlight answers wrongly.
   */
  const layout = layoutOverride ?? urlLayout ?? ambianceLayout ?? serverLayout ?? null

  useWallKeyboard({
    onTogglePause: () => (slideshow.paused ? slideshow.resume() : slideshow.pause()),
    onStep: (step) => slideshow.advance(step),
    onToggleFullscreen: toggleFullscreen,
    onCycleLayout: () =>
      setLayoutOverride((current) =>
        nextLayout(current ?? urlLayout ?? ambianceLayout ?? serverLayout ?? 'spotlight'),
      ),
    onToggleHelp: () => setHelpOpen((open) => !open),
    // Escape closes the help and nothing else; leaving fullscreen is the browser's own.
    onDismiss: closeHelp,
    onToggleQr: () => {
      // Nothing to put away on a closed event or a server that sends no invitation, and
      // flipping the flag then would hide the card at some later moment for no reason.
      if (invitation !== null) setQrHidden((hidden) => !hidden)
    },
  })

  /**
   * The host's prompts, when there are any (roadmap §2.1).
   *
   * Withheld while the wall is still empty, for the reason the join card is: the empty
   * state is a full-screen invitation, and a panel over it would be chrome covering the
   * one message the room needs at that moment. `?? []` because the field is optional on
   * the response — a server build that predates missions leaves the projector drawing
   * nothing rather than crashing it.
   */
  const missions = wall?.missions ?? []
  const showsMissions = acceptsGuests && items.length > 0 && missions.length > 0

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
  const theme = themeSurfaceProps(eventTheme, 'wall')

  return (
    <div
      {...theme}
      // What this machine has turned out not to be able to afford — roadmap 11.3.
      //
      // Every rung is a verdict taken here, on the night, by the wall watching its own frames: `budget.ts` holds the order and
      // `useFrameBudget` holds the loop. It is an attribute on the root so that
      // custom properties and descendant selectors reach
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
      // The arrow is taken off the photo after a few idle seconds (MUR-2), and is back at the
      // first movement. An attribute, so the rule that hides it is one selector in CSS.
      data-idle={cursorIdle ? 'true' : undefined}
    >
      {/* One region for the whole concern, mounted once — never one per notice. */}
      <div className={styles['notices']} aria-live="polite">
        {/*
          A lost connection is not announced to the room (MUR-9). Nothing for a minute, then a
          dot with no words, and the sentence only once it has lasted for minutes. The dot
          still carries its text as an accessible name, for the laptop a host sets up from.
        */}
        {outage === 'dot' ? (
          <span className={styles['outageDot']} role="img" aria-label={text.wall.offline} />
        ) : null}
        {outage === 'text' ? <WallNotice tone="warning" text={text.wall.offline} /> : null}
        {slideshow.paused ? <WallNotice tone="accent" text={text.wall.paused} /> : null}
      </div>

      {wall === null ? (
        <div className={styles['centre']}>
          {loading ? (
            <Spinner size="lg" label={text.app.loading} />
          ) : (
            <div className={styles['failure']} role={notServed ? 'status' : 'alert'}>
              {/*
                An event that is not on yet is not a failure (MUR-4): a host who opens the
                projector's address the day before is testing, and a red icon over "Réessayer"
                on a screen with no mouse told them it was broken. A hollow, neutral glyph,
                no button, and a promise. The server answers 404 for a draft, an archive and a
                slug that does not exist alike, so this says nothing about which one it is.
              */}
              <StatusIcon
                tone={notServed ? 'neutral' : 'danger'}
                className={cx(styles['failureIcon'], notServed && styles['calmIcon'])}
              />
              <h1 className={styles['failureTitle']}>
                {notServed
                  ? text.wall.notServedTitle
                  : error instanceof ApiError
                    ? messageForCode(error.code, text)
                    : text.wall.errorTitle}
              </h1>
              <p className={styles['failureHint']}>
                {notServed ? text.wall.notServedHint : text.wall.errorHint}
              </p>
              {/* The wall retries on its own; this is for the host who walked over
                  rather than waiting for the next attempt. A not-served screen offers none:
                  it reads again every few seconds and wakes by itself. */}
              {notServed ? null : (
                <Button size="lg" onClick={refresh}>
                  {text.app.retry}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : items.length === 0 ? (
        <WallEmptyState eventName={wall.event.name} join={join} acceptsGuests={acceptsGuests} />
      ) : (
        <WallLayouts
          layout={layout ?? wall.layout}
          items={items}
          slideshow={slideshow}
          kenBurnsDurationMs={wall.kenBurnsDurationMs}
          transitionMs={transitionMs}
        />
      )}

      {showsMissions ? <WallMissions missions={missions} /> : null}

      {showsOverlay && invitation !== null ? (
        <WallOverlay join={invitation} onDismiss={() => setQrHidden(true)} />
      ) : null}

      <ReactionBurst pulse={reactionPulse} />

      <Dialog
        open={helpOpen}
        title={text.wall.shortcuts}
        // Six layouts is more than a host can hold in their head at a projector, so the
        // one screen that explains `L` names what it walks through.
        // And how to leave: there is deliberately no exit button on the projected screen, so a guest
        // cannot drop the picture by mistake (navigation pass, A5; decision 5).
        description={[
          text.wall.shortcutsHint,
          layoutOrderHint(text),
          text.wall.leaveHint,
          // Only a wall the browser could not keep awake needs telling (MUR-2): the host's
          // own computer is then the one thing left that can turn the projector off.
          awake ? null : text.wall.keepAwakeHint,
        ]
          .filter((line) => line !== null)
          .join(' ')}
        onClose={closeHelp}
      />
    </div>
  )
}
