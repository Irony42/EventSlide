import { useState, type FormEvent } from 'react'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/ToastProvider'
import { fr } from '../../lib/i18n/fr'
import { LoadFailure, Pending } from './components/AsyncState'
import { useModerators } from './hooks/useEventData'
import { useInviteModerator, useRevokeModerator } from './hooks/useEventActions'
import styles from './ModeratorsPanel.module.css'
import type { ModeratorDto } from '../../lib/api/dto'

export interface ModeratorsPanelProps {
  readonly slug: string
}

const roleLabel = (moderator: ModeratorDto): string =>
  moderator.role === 'owner' ? fr.admin.roleOwner : fr.admin.roleModerator

/**
 * Who else can decide what reaches the screen.
 *
 * Owner-only: `GET /api/events/:slug/moderators` and both writes require it, so the
 * page mounts this panel only for an owner rather than rendering a panel whose every
 * request comes back 403.
 */
export function ModeratorsPanel({ slug }: ModeratorsPanelProps) {
  const { data: moderators, loading, error, reload } = useModerators(slug)
  const invite = useInviteModerator()
  const revoke = useRevokeModerator()
  const toast = useToast()

  const [email, setEmail] = useState('')
  const [inviteFailure, setInviteFailure] = useState<string | null>(null)
  const [selected, setSelected] = useState<ModeratorDto | null>(null)

  const list = moderators ?? []
  /**
   * An event with no owner can never be settled again — its settings, its join code
   * and its purge all require one. The server refuses to remove the last one; the UI
   * does not offer it, so a host never presses a button that cannot work.
   */
  const owners = list.filter((moderator) => moderator.role === 'owner').length

  const submitInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setInviteFailure(null)

    void invite.run('invite', slug, email.trim()).then((result) => {
      if (!result.ok) {
        setInviteFailure(result.message)
        return
      }
      toast.show(fr.admin.moderatorInvited(result.value.email), { tone: 'success' })
      setEmail('')
      reload()
    })
  }

  const confirmRevoke = () => {
    if (selected === null) return
    const moderator = selected
    void revoke.run(moderator.userId, slug, moderator.userId).then((result) => {
      setSelected(null)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(fr.admin.moderatorRevoked, { tone: 'success' })
      reload()
    })
  }

  return (
    <Card as="h2" title={fr.admin.moderators}>
      {loading ? <Pending label={fr.app.loading} /> : null}

      {!loading && error !== null ? <LoadFailure message={error} onRetry={reload} as="h3" /> : null}

      {!loading && error === null && list.length === 0 ? (
        <EmptyState as="h3" title={fr.admin.moderatorsEmpty} />
      ) : null}

      {!loading && error === null && list.length > 0 ? (
        <ul className={styles['list']}>
          {list.map((moderator) => {
            const lastOwner = moderator.role === 'owner' && owners <= 1
            return (
              <li key={moderator.userId} className={styles['row']}>
                <div className={styles['identity']}>
                  <span className={styles['email']}>{moderator.email}</span>
                  {moderator.displayName === null ? null : (
                    <span className={styles['meta']}>{moderator.displayName}</span>
                  )}
                </div>
                <Badge tone={moderator.role === 'owner' ? 'accent' : 'neutral'}>
                  {roleLabel(moderator)}
                </Badge>
                {lastOwner ? (
                  <span className={styles['locked']}>{fr.admin.lastOwnerHint}</span>
                ) : (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={revoke.pending === moderator.userId}
                    disabled={revoke.busy}
                    onClick={() => setSelected(moderator)}
                  >
                    {fr.admin.revokeModerator}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}

      <form className={styles['invite']} onSubmit={submitInvite} noValidate>
        <Field
          label={fr.admin.moderatorEmail}
          hint={fr.admin.moderatorEmailHint}
          {...(inviteFailure === null ? {} : { error: inviteFailure })}
        >
          {(control) => (
            <TextInput
              {...control}
              type="email"
              name="moderatorEmail"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <div>
          <Button type="submit" loading={invite.busy}>
            {fr.admin.inviteSubmit}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={selected !== null}
        title={fr.admin.revokeModeratorTitle}
        description={fr.admin.revokeModeratorHint}
        confirmLabel={fr.admin.revokeModerator}
        busy={revoke.busy}
        onConfirm={confirmRevoke}
        onCancel={() => setSelected(null)}
      />
    </Card>
  )
}
