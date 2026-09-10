import { Button } from './Button'
import { CloseIcon } from './CloseIcon'
import { IconButton } from './IconButton'
import { StatusIcon, type StatusTone } from './StatusIcon'
import { fr } from '../../lib/i18n/fr'
import styles from './Toast.module.css'

export type ToastTone = StatusTone

export interface ToastAction {
  readonly label: string
  readonly onAction: () => void
}

export interface ToastProps {
  readonly tone: ToastTone
  readonly message: string
  /** An undo, typically. Its presence extends the toast's life — see ToastProvider. */
  readonly action?: ToastAction
  readonly onDismiss: () => void
  readonly className?: string
}

/**
 * One transient message.
 *
 * The live region belongs to `ToastProvider`, not here, so a burst of moderation
 * decisions is announced by one region instead of six competing ones.
 */
export function Toast({ tone, message, action, onDismiss, className }: ToastProps) {
  const classes = [styles['toast'], styles[tone], className].filter(Boolean).join(' ')

  return (
    <div className={classes} data-tone={tone}>
      <span className={styles['glyph']}>
        <StatusIcon tone={tone} />
      </span>
      <span className={styles['message']}>{message}</span>
      {action === undefined ? null : (
        <Button variant="ghost" size="sm" onClick={action.onAction}>
          {action.label}
        </Button>
      )}
      <IconButton
        aria-label={fr.ui.dismissNotification}
        icon={<CloseIcon />}
        variant="ghost"
        onClick={onDismiss}
      />
    </div>
  )
}
