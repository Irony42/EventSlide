import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../../design-system/components/Card'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { IconButton } from '../../../design-system/components/IconButton'
import { Notice } from '../../../design-system/components/Notice'
import { messageForCode } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { WallOwner } from '../hooks/useWallOwner'
import type { ScreenControls } from './panelTypes'
import { ThisScreenBlock } from './ThisScreenBlock'
import { usePanelSettings } from './usePanelSettings'
import { WALL_PANEL_SECTIONS } from './wallPanelSections'
import styles from './WallSettingsPanel.module.css'

/** Without a touch for this long the panel closes itself: the room would read the configuration all night. */
export const PANEL_IDLE_MS = 60_000

export interface WallSettingsPanelProps {
  readonly slug: string
  readonly owner: WallOwner
  readonly screen: ScreenControls
  readonly onClose: () => void
}

/**
 * The host's settings, on the wall (spec 13). **Loaded on first opening** (`import()` in
 * `WallControls`), and only ever rendered for an owner session: the page does not mount this for
 * anyone else, so there is no DOM to find, hidden or not.
 *
 * Opaque and not modal: the wall keeps turning behind it so the host sees each change. It moves
 * focus in on opening (the caller gives it back), closes on `Esc` (the wall page's key handler),
 * on the cross, and after {@link PANEL_IDLE_MS} without a pointer, key or focus event inside it.
 * It only ever offers display settings: never moderation, uploads, retention or guest rights.
 */
export default function WallSettingsPanel({
  slug,
  owner,
  screen,
  onClose,
}: WallSettingsPanelProps) {
  const t = useTranslations()
  const text = t.wall.panel
  const { settings, save, state } = usePanelSettings(slug, owner.event, owner.replace)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [touched, setTouched] = useState(0)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // Re-armed by every touch inside the panel; cleared when it closes.
  useEffect(() => {
    const timer = window.setTimeout(onClose, PANEL_IDLE_MS)
    return () => window.clearTimeout(timer)
  }, [touched, onClose])

  const touch = (): void => setTouched((count) => count + 1)

  return (
    <div
      ref={rootRef}
      className={styles['panel']}
      role="dialog"
      aria-label={text.panelLabel}
      onPointerMove={(event: PointerEvent) => event.stopPropagation()}
      onPointerDown={touch}
      onKeyDown={touch}
      onFocus={touch}
    >
      <IconButton
        ref={closeRef}
        aria-label={text.close}
        icon={<CloseIcon />}
        onClick={onClose}
        className={styles['close']}
      />
      <Card title={text.title} as="h2">
        <h3 className={styles['groupTitle']}>{text.forAll}</h3>
        {WALL_PANEL_SECTIONS.map(({ id, title, Component }) => (
          <details key={id} className={styles['section']} open>
            <summary>{title(t)}</summary>
            <Component slug={slug} settings={settings} save={save} />
          </details>
        ))}
        <ThisScreenBlock screen={screen} />
        <div aria-live="polite" className={styles['status']}>
          {state.kind === 'saved' ? text.saved : null}
          {state.kind === 'saving' ? text.saving : null}
        </div>
        {state.kind === 'failed' ? (
          <Notice tone="danger" role="alert" variant="boxed">
            {state.sessionExpired ? (
              <>
                {text.sessionExpired}{' '}
                <Link to="/login" state={{ from: `/e/${encodeURIComponent(slug)}/display` }}>
                  {text.signIn}
                </Link>
              </>
            ) : state.code === undefined ? (
              text.saveFailed
            ) : (
              `${text.saveFailed} (${messageForCode(state.code, t)})`
            )}
          </Notice>
        ) : null}
      </Card>
    </div>
  )
}
