import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Icon, type IconName } from '../../../design-system/components/Icon'
import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { UiText } from '../../../lib/i18n/translations'
import { PRINT_PANELS, panelAfterKey, type PrintPanel } from './printWorkshop'
import styles from './PrintRail.module.css'

/** The id of the one tabpanel the rail controls: the page gives it to the panel it shows. */
export const PRINT_PANEL_ID = 'print-panel'

export const printTabId = (panel: PrintPanel): string => `print-tab-${panel}`

const ICONS: Readonly<Record<PrintPanel, IconName>> = {
  design: 'layout',
  texts: 'text',
  photo: 'camera',
  colours: 'palette',
  print: 'printer',
}

export const PANEL_LABELS: Readonly<Record<PrintPanel, (text: UiText) => string>> = {
  design: (text) => text.admin.printKitDesign,
  texts: (text) => text.admin.printPanelTexts,
  photo: (text) => text.admin.printKitPhoto,
  colours: (text) => text.admin.printPanelColours,
  print: (text) => text.admin.printPanelPrint,
}

/**
 * The workshop's five entries: a vertical rail on a laptop, a row on a tablet, the bottom bar of a
 * phone (the stylesheet decides).
 * One tab stays in the tab order and the arrows, Home and End move between the others, as in the
 * pattern for tabs; the page shows the matching panel.
 */
export function PrintRail({
  active,
  onChange,
}: {
  readonly active: PrintPanel
  readonly onChange: (panel: PrintPanel) => void
}) {
  const t = useTranslations()
  const tabs = useRef(new Map<PrintPanel, HTMLButtonElement>())
  const list = useRef<HTMLDivElement>(null)
  // The stylesheet decides whether the rail is a column (a wide column of the page) or a row; the
  // orientation told to a screen reader follows what is drawn.
  const [vertical, setVertical] = useState(false)
  useEffect(() => {
    const measure = () => {
      if (list.current !== null) {
        setVertical(getComputedStyle(list.current).flexDirection === 'column')
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = panelAfterKey(active, event.key)
    if (next === null) return
    event.preventDefault()
    onChange(next)
    tabs.current.get(next)?.focus()
  }

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={t.admin.printWorkshopLabel}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={styles['rail']}
      onKeyDown={onKeyDown}
    >
      {PRINT_PANELS.map((panel) => (
        <button
          key={panel}
          ref={(element) => {
            if (element === null) tabs.current.delete(panel)
            else tabs.current.set(panel, element)
          }}
          type="button"
          role="tab"
          id={printTabId(panel)}
          aria-selected={panel === active}
          aria-controls={PRINT_PANEL_ID}
          tabIndex={panel === active ? 0 : -1}
          className={cx(styles['tab'], panel === active && styles['current'])}
          onClick={() => onChange(panel)}
        >
          <Icon name={ICONS[panel]} />
          <span className={styles['label']}>{PANEL_LABELS[panel](t)}</span>
        </button>
      ))}
    </div>
  )
}
