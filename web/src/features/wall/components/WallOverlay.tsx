import { cx } from '../../../design-system/classNames'
import { JoinInvite } from './JoinInvite'
import styles from './WallOverlay.module.css'

export interface WallOverlayProps {
  /** The code and its link, both from the wall response — see {@link WallEmptyStateProps}. */
  readonly join: { readonly code: string; readonly url: string }
  readonly onDismiss: () => void
  /**
   * The corner the host chose (spec 14). Absent is the bottom end, the card as it always was. A
   * top corner is laid out by the column that stacks it above the occupants of that corner.
   */
  readonly placement?: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start'
  /** Taken out of the corner and into the flow of the column that stacks it. */
  readonly stacked?: boolean
}

/**
 * The corner reminder: how to join, once the photos have taken the screen.
 *
 * Somebody arrives at 23:00, sees a wall of photos and has no idea how to add one —
 * the printed card is on a table they are not sitting at. In 1.0 the QR existed only
 * on a separate page nobody projected, so late arrivals simply did not join.
 *
 * Only the layouts whose invitation slot is the corner draw it (`joinSlot.ts`: the spotlight);
 * the others give the invitation a place of their own. Here it is a cartel: the caption's veil,
 * laid out across rather than up, on the caption's baseline in the opposite corner, inside the
 * projector safe area. The content and its rules are {@link JoinInvite}'s.
 */
export function WallOverlay({
  join,
  onDismiss,
  placement = 'bottom-end',
  stacked = false,
}: WallOverlayProps) {
  return (
    <JoinInvite
      join={join}
      slot="corner"
      onDismiss={onDismiss}
      className={cx(
        styles['overlay'],
        placement === 'bottom-start' && styles['bottomStart'],
        stacked && styles['stacked'],
      )}
      placement={placement === 'bottom-end' ? undefined : placement}
    />
  )
}
