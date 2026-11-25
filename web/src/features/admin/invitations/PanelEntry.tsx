import { Icon, type IconName } from '../../../design-system/components/Icon'
import styles from './PanelEntry.module.css'

export interface PanelEntryProps {
  readonly id: string
  readonly icon: IconName
  readonly title: string
  /** One line: what the panel holds now. */
  readonly summary: string
  readonly onOpen: () => void
}

/**
 * A door to a panel, on the card's screen: an icon, the panel's name and **one line of what it
 * holds** ("Demandées jusqu'au 6 déc. · 4 options"), cut with an ellipsis when it is long. It is
 * a navigation button, not a disclosure: the panel replaces the column this button is in.
 */
export function PanelEntry({ id, icon, title, summary, onOpen }: PanelEntryProps) {
  return (
    <button id={id} type="button" className={styles['entry']} onClick={onOpen}>
      <span className={styles['icon']}>
        <Icon name={icon} />
      </span>
      <span className={styles['text']}>
        <span className={styles['title']}>{title}</span>
        <span className={styles['summary']}>{summary}</span>
      </span>
      <Icon name="chevron" size="sm" className={styles['go']} />
    </button>
  )
}
