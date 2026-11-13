import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../classNames'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { Button } from './Button'
import type { ReadableRef } from './Dialog'
import { placeBubble, unionOf, type Box, type TourPlacement, type TourSide } from './tourPlacement'
import styles from './GuidedTour.module.css'

export interface TourStep {
  readonly id: string
  /**
   * The `data-tour` values of what this step lights up, as one box around all of them. Empty for
   * a step about the page as a whole (the welcome), which dims everything and lights nothing.
   * A step whose elements are not on the page when the tour opens is left out.
   */
  readonly targets: readonly string[]
  readonly title: string
  readonly body: string
  /** The side of the lit element the bubble prefers; it moves when there is no room there. */
  readonly side?: TourSide
}

export interface GuidedTourProps {
  readonly open: boolean
  readonly steps: readonly TourStep[]
  /** The person went through to the last step and pressed "Terminer". */
  readonly onFinish: () => void
  /** The person left before the end: "Plus tard", "Passer" or Escape. */
  readonly onDismiss: () => void
  /** Where focus goes when the tour closes. Defaults to what had it when the tour opened. */
  readonly returnFocusRef?: ReadableRef
}

/** Below this viewport width the bubble is a sheet along the bottom of the screen. */
const SHEET_BELOW = 640
/** Room between the lit element and the edge of the light. */
const PAD = 8

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/** What one measure of a step found: where its region is, and where its bubble goes. */
interface Layout {
  readonly stepId: string
  readonly sheet: boolean
  readonly box: Box | null
  readonly placement: TourPlacement | null
}

const elementsOf = (step: TourStep): HTMLElement[] =>
  step.targets.flatMap((name) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)),
  )

const boxOf = (step: TourStep): Box | null =>
  unionOf(
    elementsOf(step)
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 || rect.height > 0)
      .map((rect) => ({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })),
  )

const padded = (box: Box): Box => ({
  top: box.top - PAD,
  left: box.left - PAD,
  width: box.width + 2 * PAD,
  height: box.height + 2 * PAD,
})

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A short guided tour of a page: the page dims, one region at a time is lit, and a bubble beside
 * it says what it is for (surface: the host's console; the first visit to an event's page).
 *
 * **Modal while it is open.** A layer over the whole page takes every click, the lit region
 * included, so nothing on the page can be pressed from under the tour and nothing leaves it by
 * accident; the bubble's own buttons are the only way on or out. Tab stays in the bubble, Escape
 * leaves, ← and → move. Focus goes back where it came from when the tour closes.
 *
 * **It follows the page rather than freezing it.** The lit region is measured again on every
 * scroll and resize, so the page can still be scrolled by wheel or finger and the light stays on
 * what it explains. Each step brings its region into view first.
 *
 * **The bubble always fits.** Beside the region on a laptop (`placeBubble` keeps it inside the
 * viewport whatever the region does), a sheet along the bottom below 640 px, and its buttons wrap
 * rather than leave it.
 */
export function GuidedTour(props: GuidedTourProps) {
  if (!props.open) return null
  return createPortal(<TourLayer {...props} />, document.body)
}

function TourLayer({ steps: offered, onFinish, onDismiss, returnFocusRef }: GuidedTourProps) {
  const t = useTranslations()
  const titleId = useId()
  const bodyId = useId()
  const bubbleRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  const layerRef = useRef<HTMLDivElement>(null)

  // Decided once, when the tour opens: a step about something this page does not show (a
  // moderator has no lifecycle buttons) is not a step. On the next frame and not during render: a
  // tour that opens with the page is rendered in the same commit as the regions it lights, and
  // they are not in the document until that commit lands. Only the ids are kept, so the words of
  // each step stay the page's current ones (a language switched while the tour is open).
  const [kept, setKept] = useState<readonly string[] | null>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setKept(
        offered
          .filter((step) => step.targets.length === 0 || elementsOf(step).length > 0)
          .map((step) => step.id),
      )
    })
    return () => cancelAnimationFrame(frame)
    // Once per opening, on purpose: a page that re-renders does not reshuffle the tour under the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const steps = kept === null ? null : offered.filter((step) => kept.includes(step.id))
  const [opener] = useState(() => document.activeElement)
  const [index, setIndex] = useState(0)
  const [layout, setLayout] = useState<Layout | null>(null)

  const step = steps?.[index]
  const stepId = step?.id
  const last = steps !== null && index === steps.length - 1
  const intro = step !== undefined && step.targets.length === 0 && index === 0
  const numbered = (steps ?? []).filter((candidate) => candidate.targets.length > 0)
  const position = step === undefined ? 0 : numbered.findIndex((one) => one.id === step.id) + 1
  // A step is shown once it has been measured: until then its bubble is laid out but hidden, so
  // it never shows for a frame where the last step left it.
  const pending = step === undefined || layout?.stepId !== step.id

  // The step as the page describes it now, for the measure that runs on scroll and resize: the
  // page hands a new list on every render, and the effects below must not restart for that.
  const stepRef = useRef(step)
  useEffect(() => {
    stepRef.current = step
  })

  const measure = useCallback(() => {
    const current = stepRef.current
    if (current === undefined) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const narrow = viewport.width < SHEET_BELOW
    const target = boxOf(current)
    const bubble = bubbleRef.current
    setLayout({
      stepId: current.id,
      sheet: narrow,
      box: target === null ? null : padded(target),
      placement:
        target === null || bubble === null || narrow
          ? null
          : placeBubble(
              padded(target),
              { width: bubble.offsetWidth, height: bubble.offsetHeight },
              viewport,
              current.side,
            ),
    })
  }, [])

  // Each step brings what it lights into view, is measured on the next frame, and again on every
  // scroll and resize after that, so the light follows the page.
  useEffect(() => {
    const current = stepRef.current
    if (current === undefined) return
    const first = elementsOf(current)[0]
    if (first !== undefined && typeof first.scrollIntoView === 'function') {
      first.scrollIntoView({
        block: window.innerWidth < SHEET_BELOW ? 'start' : 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
    }
    let frame = requestAnimationFrame(measure)
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [stepId, measure])

  // The step's main button takes focus once the step is shown: a hidden button cannot.
  useEffect(() => {
    if (!pending) primaryRef.current?.focus({ preventScroll: true })
  }, [pending, stepId])

  // The page under the tour is inert while it is open: no click, no focus, and nothing a screen
  // reader can wander into. Everything else in the body is, not only the app: a toast or another
  // portal is as much "under" the tour. Each element is given back as it was.
  useEffect(() => {
    const layer = layerRef.current
    const others = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== layer && !element.hasAttribute('inert'),
    )
    for (const element of others) element.setAttribute('inert', '')
    return () => {
      for (const element of others) element.removeAttribute('inert')
    }
  }, [])

  const next = useCallback(() => {
    if (last) onFinish()
    else setIndex((current) => current + 1)
  }, [last, onFinish])
  const previous = useCallback(() => setIndex((current) => Math.max(0, current - 1)), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Not the browser's own shortcuts (Alt+← is "back"), and nothing before the first step.
      if (event.altKey || event.ctrlKey || event.metaKey || stepId === undefined) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        // A stray key does not end the tour: finishing is the button's.
        if (!last) next()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        previous()
      } else if (event.key === 'Tab') {
        const focusable = Array.from(
          bubbleRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
        )
        const first = focusable[0]
        const final = focusable[focusable.length - 1]
        if (first === undefined || final === undefined) return
        const inside = bubbleRef.current?.contains(document.activeElement) ?? false
        if (event.shiftKey && (document.activeElement === first || !inside)) {
          event.preventDefault()
          final.focus()
        } else if (!event.shiftKey && (document.activeElement === final || !inside)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [next, previous, onDismiss, last, stepId])

  // Focus goes back on close: to the page's "Visite guidée" button when there is one, so the
  // person learns where the tour lives, else to what had it before.
  useEffect(
    () => () => {
      const back = returnFocusRef?.current ?? opener
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true })
    },
    [returnFocusRef, opener],
  )

  if (step === undefined) return <div ref={layerRef} className={styles['layer']} />

  const sheet = layout?.sheet ?? window.innerWidth < SHEET_BELOW
  // While a step is measured the light stays where the last one was; the first step has none yet.
  const box = layout?.box ?? null
  const placement = pending ? null : (layout?.placement ?? null)

  const bubbleStyle =
    placement === null
      ? undefined
      : ({
          top: `${placement.top}px`,
          left: `${placement.left}px`,
          '--tour-arrow': `${placement.arrow}px`,
        } as CSSProperties)

  return (
    <div ref={layerRef} className={styles['layer']} data-testid="guided-tour">
      {box === null ? (
        <div className={styles['dim']} aria-hidden="true" />
      ) : (
        <div
          className={styles['light']}
          aria-hidden="true"
          style={{
            top: `${box.top}px`,
            left: `${box.left}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
          }}
        />
      )}
      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={cx(
          styles['bubble'],
          sheet ? styles['sheet'] : undefined,
          !sheet && placement === null ? styles['centred'] : undefined,
        )}
        data-side={placement?.side ?? 'none'}
        data-pending={pending ? '' : undefined}
        style={bubbleStyle}
      >
        {intro ? null : (
          <div className={styles['head']}>
            <p className={styles['count']}>{t.ui.tourStep(position, numbered.length)}</p>
            <ol className={styles['dots']} aria-hidden="true">
              {numbered.map((candidate) => (
                <li key={candidate.id} data-on={candidate === step ? '' : undefined} />
              ))}
            </ol>
          </div>
        )}
        <h2 id={titleId} className={styles['title']}>
          {step.title}
        </h2>
        <p id={bodyId} className={styles['body']}>
          {step.body}
        </p>
        <div className={styles['actions']}>
          {last ? null : (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              {intro ? t.ui.tourLater : t.ui.tourSkip}
            </Button>
          )}
          <span className={styles['spacer']} />
          {index === 0 ? null : (
            <Button variant="secondary" size="sm" onClick={previous}>
              {t.ui.tourPrevious}
            </Button>
          )}
          <Button ref={primaryRef} variant="primary" size="sm" onClick={next}>
            {intro ? t.ui.tourStart : last ? t.ui.tourFinish : t.ui.tourNext}
          </Button>
        </div>
      </div>
    </div>
  )
}
