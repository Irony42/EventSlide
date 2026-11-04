import { useRef, type KeyboardEvent } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { panelId, tabId, type ConsoleTab } from './consoleTabIds'
import styles from './ConsoleTabs.module.css'

export interface ConsoleTabsProps {
  readonly tab: ConsoleTab
  readonly onChange: (tab: ConsoleTab) => void
  readonly photosPending: number
  readonly messagesPending: number
  /** Automatic moderation: the badge counts messages that went up unread (spec 15). */
  readonly messagesAreFresh: boolean
}

const ORDER: readonly ConsoleTab[] = ['photos', 'messages']

/**
 * "Photos | Messages", each with its badge, always visible. Arrow keys move between the
 * two; J and K stay the queue's. Never switches by itself: a tab changing under a host
 * mid-decision would take the keyboard with it.
 */
export function ConsoleTabs({
  tab,
  onChange,
  photosPending,
  messagesPending,
  messagesAreFresh,
}: ConsoleTabsProps) {
  const t = useTranslations()
  const refs = useRef(new Map<ConsoleTab, HTMLButtonElement>())

  const name = (which: ConsoleTab): string => {
    const base = which === 'photos' ? t.moderation.tabPhotos : t.moderation.tabMessages
    const count = which === 'photos' ? photosPending : messagesPending
    if (count === 0) return base
    return which === 'messages' && messagesAreFresh
      ? t.moderation.tabFresh(base, count)
      : t.moderation.tabCounted(base, count)
  }

  const onKeyDown = (event: KeyboardEvent, which: ConsoleTab) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = ORDER[(ORDER.indexOf(which) + step + ORDER.length) % ORDER.length]
    if (next === undefined) return
    onChange(next)
    refs.current.get(next)?.focus()
  }

  return (
    <div className={styles['tabs']} role="tablist" aria-label={t.moderation.tabsLabel}>
      {ORDER.map((which) => {
        const count = which === 'photos' ? photosPending : messagesPending
        return (
          <button
            key={which}
            ref={(element) => {
              if (element === null) refs.current.delete(which)
              else refs.current.set(which, element)
            }}
            type="button"
            role="tab"
            id={tabId(which)}
            aria-selected={tab === which}
            aria-controls={panelId(which)}
            aria-label={name(which)}
            tabIndex={tab === which ? 0 : -1}
            className={styles['tab']}
            onClick={() => onChange(which)}
            onKeyDown={(event) => onKeyDown(event, which)}
          >
            <span>{which === 'photos' ? t.moderation.tabPhotos : t.moderation.tabMessages}</span>
            {count > 0 ? <Badge tone="warning">{String(count)}</Badge> : null}
          </button>
        )
      })}
    </div>
  )
}
