import { cx } from '../../../design-system/classNames'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { IconButton } from '../../../design-system/components/IconButton'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { joinHost } from '../../../lib/joinHost'
import type { JoinSlot } from '../joinSlot'
import { JoinQr } from './JoinQr'
import styles from './JoinInvite.module.css'

export interface JoinInviteProps {
  /** The code and its link, both from the wall response, never one without the other. */
  readonly join: { readonly code: string; readonly url: string }
  /** Which layout's place this is: it decides the dress and the title, never the QR. */
  readonly slot: JoinSlot
  readonly onDismiss: () => void
  /** The positioning a container gives it (the spotlight's corner). */
  readonly className?: string | undefined
  /** The corner, only when it is not the default bottom end (spec 14). */
  readonly placement?: string | undefined
}

/**
 * The invitation, in whatever place the layout gave it (`joinSlot.ts`).
 *
 * The content never changes with the slot: the QR at the host's scale, a title that says what to
 * do, the code in characters, and where to type it for the phone that cannot read a QR (MUR-7).
 * Only the dress does — a cartel, a tile, a print, a tag, a ticket, a medallion — so the room
 * reads it as part of the picture rather than as a box laid over it.
 *
 * The close button is for a host who walked up with a mouse: it shows only while the pointer is over
 * the invitation (or the keyboard is on it), since a projector nobody touches has no use for a
 * cross on the invitation. `Q` puts it away from the keyboard either way.
 */
export function JoinInvite({ join, slot, onDismiss, className, placement }: JoinInviteProps) {
  const text = useTranslations()
  const host = joinHost(join.url)
  const prompt =
    slot === 'corner' || slot === 'band' ? text.wall.sendPrompt : text.wall.invitePrompt[slot]

  return (
    <section
      className={cx(styles['invite'], styles[slot], className)}
      data-testid="wall-invite"
      data-slot={slot}
      data-placement={placement}
    >
      <IconButton
        className={styles['dismiss']}
        data-join-dismiss=""
        aria-label={text.wall.dismissJoinCard}
        icon={<CloseIcon />}
        variant="ghost"
        onClick={onDismiss}
      />
      <div className={styles['qr']}>
        <JoinQr url={join.url} />
      </div>
      <div className={styles['body']}>
        <h2 className={styles['prompt']}>{prompt}</h2>
        <p className={styles['code']}>{join.code}</p>
        {host === null ? null : (
          <p className={styles['address']}>{text.wall.typeCodeAt(join.code, host)}</p>
        )}
      </div>
    </section>
  )
}
