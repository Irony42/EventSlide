import { useContext, useState, type ReactNode } from 'react'
import { Icon } from '../../../design-system/components/Icon'
import { OpenGroupsContext } from './openGroups'
import styles from './Disclosure.module.css'

export interface DisclosureProps {
  /** Names the group for the page's memory of what is open. */
  readonly id: string
  readonly title: string
  /** What the group holds now, on the folded line: the value is readable without opening it. */
  readonly summary: string
  /** Opened and kept open: something inside needs the host (a refused value). */
  readonly forceOpen?: boolean
  readonly children: ReactNode
}

/**
 * A group that folds: a native `<details>`, so the keyboard, the screen reader and the browser's
 * own find all know it, with a **summary line** that says what is inside without opening it. Two
 * levels at most: a group never holds another one.
 */
export function Disclosure({ id, title, summary, forceOpen = false, children }: DisclosureProps) {
  const memory = useContext(OpenGroupsContext)
  const [local, setLocal] = useState(false)
  const open = forceOpen || (memory === null ? local : memory.isOpen(id))
  return (
    <details
      className={styles['group']}
      open={open}
      onToggle={(event) => {
        const now = event.currentTarget.open
        if (now === open) return
        if (memory === null) setLocal(now)
        else memory.setOpen(id, now)
      }}
    >
      <summary className={styles['summary']}>
        <span className={styles['title']}>{title}</span>
        <span className={styles['value']}>{summary}</span>
        <Icon name="chevron" size="sm" className={styles['chevron']} />
      </summary>
      <div className={styles['body']}>{children}</div>
    </details>
  )
}
