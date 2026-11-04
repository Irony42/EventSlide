import { lazy, Suspense, useEffect, useRef, type RefObject } from 'react'
import { Button } from '../../../design-system/components/Button'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { WallOwner } from '../hooks/useWallOwner'
import type { ScreenControls } from '../panel/panelTypes'
import styles from './WallControls.module.css'

/**
 * The panel is a chunk of its own, fetched at the **first opening** (spec 13, §6): a projector
 * that is never touched never downloads it, and a guest's screen never has it at all.
 */
const WallSettingsPanel = lazy(() => import('../panel/WallSettingsPanel'))

export interface WallControlsProps {
  readonly slug: string
  readonly owner: WallOwner
  readonly screen: ScreenControls
  /** The pointer moved recently (`useIdleCursor` is not idle). */
  readonly active: boolean
  readonly panelOpen: boolean
  readonly onOpenPanel: () => void
  readonly onClosePanel: () => void
  /** Where the page keeps the opener, so `R` and Esc leave the focus on a button that exists. */
  readonly openerRef: RefObject<HTMLButtonElement | null>
}

/**
 * The owner's bar at the bottom centre of the wall, and the panel it opens (spec 13).
 *
 * Mounted by the wall page **only** for an owner session, so a guest has neither this nor its
 * DOM. Transitory: it is there while the pointer moves, while one of its buttons has focus, or
 * while the panel is open, and gone with the cursor otherwise. Bottom centre because every
 * other corner and the top centre belong to something that stays.
 */
export function WallControls({
  slug,
  owner,
  screen,
  active,
  panelOpen,
  onOpenPanel,
  onClosePanel,
  openerRef,
}: WallControlsProps) {
  const t = useTranslations()
  const text = t.wall.panel
  const wasOpen = useRef(false)

  // Focus goes back to the button that opened the panel, as a dialog should leave it.
  useEffect(() => {
    if (wasOpen.current && !panelOpen) openerRef.current?.focus()
    wasOpen.current = panelOpen
  }, [panelOpen, openerRef])

  return (
    <>
      <div
        className={styles['bar']}
        role="group"
        aria-label={text.barLabel}
        data-visible={active || panelOpen ? 'true' : undefined}
      >
        <Button
          ref={openerRef}
          onClick={onOpenPanel}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
        >
          {text.open}
        </Button>
        <Button onClick={screen.onTogglePause}>{screen.paused ? text.resume : text.pause}</Button>
        <Button onClick={screen.onToggleFullscreen}>{text.fullscreen}</Button>
      </div>
      {panelOpen ? (
        <Suspense fallback={null}>
          <WallSettingsPanel slug={slug} owner={owner} screen={screen} onClose={onClosePanel} />
        </Suspense>
      ) : null}
    </>
  )
}
