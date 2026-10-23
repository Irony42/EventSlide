import { useState, type FormEvent } from 'react'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from './components/AsyncState'
import { useModerators } from './hooks/useEventData'
import { useInviteModerator, useRevokeModerator } from './hooks/useEventActions'
import styles from './ModeratorsPanel.module.css'
import type { ModeratorDto } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'

export interface ModeratorsPanelProps {
  readonly slug: string
}

const roleLabel = (moderator: ModeratorDto, text: UiText): string =>
  moderator.role === 'owner' ? text.admin.roleOwner : text.admin.roleModerator

/**
 * Who else can decide what reaches the screen.
 *
 * Owner-only: `GET /api/events/:slug/moderators` and both writes require it, so the
 * page mounts this panel only for an owner rather than rendering a panel whose every
 * request comes back 403.
 */
export function ModeratorsPanel({ slug }: ModeratorsPanelProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const { data: moderators, loading, error, reload } = useModerators(slug)
  const invite = useInviteModerator()
  const revoke = useRevokeModerator()
  const toast = useToast()

  const [email, setEmail] = useState('')
  /**
   * The link of an invitation that was **not** mailed, for the host to pass on: present only
   * when the box has no mail relay (or it refused), and the only time it exists outside the
   * host's own message. Cleared by the next invitation, and never stored.
   */
  const [pending, setPending] = useState<{ readonly email: string; readonly link: string } | null>(
    null,
  )
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
    setPending(null)

    const address = email.trim()

    // The language of this page is the language the invitation is written in: the host is
    // writing to somebody in their own language, and the form has no field for another.
    void invite.run('invite', slug, { email: address, locale }).then((result) => {
      if (!result.ok) {
        setInviteFailure(result.message)
        return
      }
      // The answer is the same whether or not the address already has an account, so the
      // panel says the same: an invitation exists, and the person has to accept it. With no
      // mail it carries the link, which the host passes on.
      if (result.value.link === undefined) {
        toast.show(t.admin.moderatorInviteSent(address), { tone: 'success' })
      } else {
        setPending({ email: address, link: result.value.link })
      }
      setEmail('')
      reload()
    })
  }

  const copyLink = () => {
    if (pending === null) return
    // The address is also selectable in the field beside this button, so a browser that
    // refuses the clipboard costs the host a long-press rather than the link — and says so.
    // `navigator.clipboard` does not exist on an address that is not a secure context, which
    // includes the plain-HTTP LAN deployment this product is at home on.
    const failed = () => toast.show(t.admin.inviteLinkCopyFailed, { tone: 'danger' })
    if (navigator.clipboard === undefined) {
      failed()
      return
    }
    void navigator.clipboard
      .writeText(pending.link)
      .then(() => toast.show(t.admin.inviteLinkCopied, { tone: 'success' }), failed)
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
      toast.show(t.admin.moderatorRevoked, { tone: 'success' })
      reload()
    })
  }

  return (
    <Card as="h2" title={t.admin.moderators}>
      {loading ? <Pending label={t.app.loading} /> : null}

      {!loading && error !== null ? <LoadFailure message={error} onRetry={reload} as="h3" /> : null}

      {!loading && error === null && list.length === 0 ? (
        <EmptyState as="h3" title={t.admin.moderatorsEmpty} />
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
                  {roleLabel(moderator, t)}
                </Badge>
                {lastOwner ? (
                  <span className={styles['locked']}>{t.admin.lastOwnerHint}</span>
                ) : (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={revoke.pending === moderator.userId}
                    disabled={revoke.busy}
                    onClick={() => setSelected(moderator)}
                  >
                    {t.admin.revokeModerator}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}

      {pending === null ? null : (
        <div className={styles['created']}>
          <p>{t.admin.inviteLinkCreated(pending.email)}</p>
          <Field label={t.admin.inviteLinkUrl}>
            {(control) => (
              <TextInput
                {...control}
                readOnly
                // Focus lands on the link and selects it (below), so a screen reader reads what
                // appeared and a long-press or Ctrl+C copies it: the block would otherwise
                // appear silently above the form, behind the button that was just pressed.
                autoFocus
                value={pending.link}
                onFocus={(focused) => focused.target.select()}
              />
            )}
          </Field>
          <div>
            <Button variant="primary" onClick={copyLink}>
              {t.admin.inviteLinkCopy}
            </Button>
          </div>
        </div>
      )}

      <form className={styles['invite']} onSubmit={submitInvite} noValidate>
        <Field
          label={t.admin.moderatorEmail}
          hint={t.admin.moderatorEmailHint}
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
            {t.admin.inviteSubmit}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={selected !== null}
        title={t.admin.revokeModeratorTitle}
        description={t.admin.revokeModeratorHint}
        confirmLabel={t.admin.revokeModerator}
        busy={revoke.busy}
        onConfirm={confirmRevoke}
        onCancel={() => setSelected(null)}
      />
    </Card>
  )
}
