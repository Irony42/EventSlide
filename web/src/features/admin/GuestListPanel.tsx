import { useState } from 'react'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../design-system/components/EmptyState'
import { useToast } from '../../design-system/components/useToast'
import { formatDateTime } from '../../lib/format'
import { fr } from '../../lib/i18n/fr'
import { LoadFailure, Pending } from './components/AsyncState'
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
  const { data, loading, error, reload } = useGuests(slug)
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
      toast.show(fr.admin.guestRevoked, { tone: 'success' })
      reload()
    })
  }

  const guests = data?.items ?? []

  return (
    <Card
      as="h2"
      title={fr.admin.guestList}
      {...(data === null ? {} : { subtitle: fr.admin.guests(data.activeCount) })}
    >
      {loading ? <Pending label={fr.app.loading} /> : null}

      {!loading && error !== null ? <LoadFailure message={error} onRetry={reload} as="h3" /> : null}

      {!loading && error === null && guests.length === 0 ? (
        <EmptyState as="h3" title={fr.admin.guestsEmpty} description={fr.admin.guestsEmptyHint} />
      ) : null}

      {!loading && error === null && guests.length > 0 ? (
        <ul className={styles['list']}>
          {guests.map((guest) => {
            const lastSeen = formatDateTime(guest.lastSeenAt)
            return (
              <li key={guest.id} className={styles['row']}>
                <div className={styles['identity']}>
                  <span className={styles['name']}>
                    {guest.displayName === null ? (
                      <em className={styles['anonymous']}>{fr.moderation.byAnonymous}</em>
                    ) : (
                      guest.displayName
                    )}
                  </span>
                  <span className={styles['meta']}>
                    <span>{fr.admin.photos(guest.photoCount)}</span>
                    <span>{fr.admin.lastSeen(lastSeen ?? fr.admin.dateUnknown)}</span>
                  </span>
                </div>
                {guest.revoked ? (
                  <Badge tone="danger">{fr.admin.guestRevokedBadge}</Badge>
                ) : canRevoke ? (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={revoke.pending === guest.id}
                    disabled={revoke.busy}
                    onClick={() => setSelected(guest)}
                  >
                    {fr.admin.revokeGuest}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      <ConfirmDialog
        open={selected !== null}
        title={fr.admin.revokeGuestTitle}
        description={fr.admin.revokeGuestHint}
        confirmLabel={fr.admin.revokeGuest}
        busy={revoke.busy}
        onConfirm={confirmRevoke}
        onCancel={() => setSelected(null)}
      />
    </Card>
  )
}
