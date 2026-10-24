import { useState } from 'react'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useToast } from '../../design-system/components/useToast'
import { formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { Async } from '../../design-system/components/Async'
import { useGuests } from './hooks/useEventData'
import { useRevokeGuest } from './hooks/useEventActions'
import styles from './GuestListPanel.module.css'
import type { GuestDto } from '../../lib/api/dto'

export interface GuestListPanelProps {
  readonly slug: string
  /** False for an archived event: there is nothing left to revoke access to. */
  readonly canRevoke: boolean
}

/**
 * Who is in the room, and how to remove one of them.
 *
 * The one control here that matters on the night: a guest sending things nobody wants
 * on a screen. Revoking is behind a confirmation because it is not reversible from
 * this screen — the guest has to scan again.
 */
export function GuestListPanel({ slug, canRevoke }: GuestListPanelProps) {
  const t = useTranslations()
  // The last-seen column is a date, and a date is read differently in each of the five.
  const { locale } = useLocale()
  const guests = useGuests(slug)
  const { reload } = guests
  // The list the answer holds, so that `Async` can tell an empty one from none yet.
  const roster = { ...guests, data: guests.data?.items ?? null }
  const revoke = useRevokeGuest()
  const toast = useToast()
  const [selected, setSelected] = useState<GuestDto | null>(null)

  const confirmRevoke = () => {
    if (selected === null) return
    const guest = selected
    void revoke.run(guest.id, slug, guest.id).then((result) => {
      setSelected(null)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(t.admin.guestRevoked, { tone: 'success' })
      reload()
    })
  }

  return (
    <Card
      as="h2"
      title={t.admin.guestList}
      {...(guests.data === null ? {} : { subtitle: t.admin.guests(guests.data.activeCount) })}
    >
      <Async
        state={roster}
        as="h3"
        empty={
          <EmptyState as="h3" title={t.admin.guestsEmpty} description={t.admin.guestsEmptyHint} />
        }
      >
        {(rows) => (
          <ul className={styles['list']}>
            {rows.map((guest) => {
              const lastSeen = formatDateTime(guest.lastSeenAt, locale)
              return (
                <li key={guest.id} className={styles['row']}>
                  <div className={styles['identity']}>
                    <span className={styles['name']}>
                      {guest.displayName === null ? (
                        <em className={styles['anonymous']}>{t.moderation.byAnonymous}</em>
                      ) : (
                        guest.displayName
                      )}
                    </span>
                    <span className={styles['meta']}>
                      <span>{t.admin.photos(guest.photoCount)}</span>
                      <span>{t.admin.lastSeen(lastSeen ?? t.admin.dateUnknown)}</span>
                    </span>
                  </div>
                  {guest.revoked ? (
                    <Badge tone="danger">{t.admin.guestRevokedBadge}</Badge>
                  ) : canRevoke ? (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={revoke.pending === guest.id}
                      disabled={revoke.busy}
                      onClick={() => setSelected(guest)}
                    >
                      {t.admin.revokeGuest}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Async>

      <ConfirmDialog
        open={selected !== null}
        title={t.admin.revokeGuestTitle}
        description={t.admin.revokeGuestHint}
        confirmLabel={t.admin.revokeGuest}
        busy={revoke.busy}
        onConfirm={confirmRevoke}
        onCancel={() => setSelected(null)}
      />
    </Card>
  )
}
