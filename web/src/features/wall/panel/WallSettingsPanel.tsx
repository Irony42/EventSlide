import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/components/Icon'
import { IconButton } from '../../../design-system/components/IconButton'
import { Notice } from '../../../design-system/components/Notice'
import { Tooltip } from '../../../design-system/components/Tooltip'
import { messageForCode } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { WallOwner } from '../hooks/useWallOwner'
import type { ScreenControls } from './panelTypes'
import { ThisScreenBlock } from './ThisScreenBlock'
import { usePanelSettings } from './usePanelSettings'
import { WALL_PANEL_SECTIONS } from './wallPanelSections'
import styles from './WallSettingsPanel.module.css'

/** The anchor of a section, for the drawer's jump row. */
const sectionId = (id: string): string => `wall-panel-section-${id}`

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

  /** Opens the section and brings it to the top of the drawer, with the focus on its title. */
  const jumpTo = (id: string): void => {
    const section = rootRef.current?.querySelector<HTMLDetailsElement>(`#${sectionId(id)}`)
    if (section === null || section === undefined) return
    section.open = true
    section.scrollIntoView?.({ block: 'start' })
    section.querySelector('summary')?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={styles['panel']}
      role="dialog"
      aria-label={text.panelLabel}
      onPointerDown={touch}
      onKeyDown={(event) => {
        // The window's key handler ignores keys typed in a control, and focus lives in one here.
        if (event.key === 'Escape') onClose()
        else touch()
      }}
      onFocus={touch}
    >
      <header className={styles['header']}>
        <span className={styles['badge']}>
          <Icon name="settings" />
        </span>
        <h2 className={styles['title']}>{text.title}</h2>
        <div aria-live="polite" className={styles['status']}>
          {state.kind === 'saved' ? (
            <>
              <Icon name="check" size="sm" />
              {text.saved}
            </>
          ) : null}
          {state.kind === 'saving' ? text.saving : null}
        </div>
        <IconButton
          ref={closeRef}
          aria-label={text.close}
          icon={<Icon name="close" size="sm" />}
          onClick={onClose}
        />
      </header>
      <nav className={styles['jump']} aria-label={text.sectionJump}>
        {WALL_PANEL_SECTIONS.map(({ id, title, icon }) => (
          <Tooltip key={id} text={title(t)} placement="below">
            {(describedBy) => (
              <IconButton
                aria-label={title(t)}
                aria-describedby={describedBy}
                icon={<Icon name={icon} size="sm" />}
                onClick={() => jumpTo(id)}
              />
            )}
          </Tooltip>
        ))}
      </nav>
      <div className={styles['scroll']}>
        <h3 className={styles['groupTitle']}>
          <Icon name="globe" size="sm" />
          {text.forAll}
        </h3>
        {WALL_PANEL_SECTIONS.map(({ id, title, icon, summary, Component }) => {
          const current = summary?.(t, settings) ?? null
          return (
            <details key={id} id={sectionId(id)} className={styles['section']} open>
              <summary className={styles['sectionHead']}>
                <span className={styles['badge']}>
                  <Icon name={icon} />
                </span>
                <span className={styles['sectionTitle']}>
                  <strong>{title(t)}</strong>
                  {current === null ? null : <small>{current}</small>}
                </span>
                <Icon name="chevron" size="sm" className={styles['chevron']} />
              </summary>
              <div className={styles['sectionBody']}>
                <Component slug={slug} settings={settings} save={save} screen={screen} />
              </div>
            </details>
          )
        })}
        <ThisScreenBlock screen={screen} />
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
      </div>
    </div>
  )
}
