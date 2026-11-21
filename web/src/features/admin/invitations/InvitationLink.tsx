import { useState } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { NewTabLink } from '../../../design-system/components/NewTabLink'
import { Notice } from '../../../design-system/components/Notice'
import { useToast } from '../../../design-system/components/useToast'
import type { GuestInviteDto } from '../../../lib/api/dto'
import { copyToClipboard } from '../../../lib/clipboard'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useApi } from '../../../lib/useApi'
import styles from './InvitationsPage.module.css'

export interface InvitationLinkProps {
  readonly slug: string
  readonly invite: GuestInviteDto
  readonly disabled: boolean
  readonly onChanged: (invite: GuestInviteDto) => void
}

/**
 * "Le lien de l'invitation": switch it on, copy it, see the page as a guest, change the link,
 * switch it off.
 *
 * Surface: the host (the owner). **Every act is the server's**: whether there is a date to
 * announce, what the link is now, whether it was already on. This shows the answer. Changing the
 * link asks first and says what it costs (the printed QR codes and the links already sent stop
 * working); switching off is not destructive (the same link comes back), so it asks nothing.
 */
export function InvitationLink({ slug, invite, disabled, onChanged }: InvitationLinkProps) {
  const t = useTranslations()
  const text = t.guestInvite.host
  const api = useApi()
  const toast = useToast()
  const [busy, setBusy] = useState<'enable' | 'disable' | 'rotate' | null>(null)
  const [confirmingRotate, setConfirmingRotate] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const act = async (
    which: 'enable' | 'disable' | 'rotate',
    call: () => Promise<{ readonly guestInvite: GuestInviteDto }>,
    done: string,
  ) => {
    setBusy(which)
    setProblem(null)
    try {
      const answer = await call()
      onChanged(answer.guestInvite)
      toast.show(done, { tone: 'success' })
    } catch (cause) {
      setProblem(messageForError(cause, t))
    } finally {
      setBusy(null)
      setConfirmingRotate(false)
    }
  }

  const copy = async (url: string) => {
    const copied = await copyToClipboard(url)
    toast.show(copied ? text.copied : text.copyFailed, { tone: copied ? 'success' : 'warning' })
  }

  const url = invite.url
  // A saved start is what the server will accept: the form below may hold one not saved yet.
  const dated = invite.startsAt !== null

  return (
    <section className={styles['panel']} aria-labelledby="invite-link-title">
      <h2 id="invite-link-title" className={styles['panelTitle']}>
        {text.linkTitle}
        <Badge tone={invite.enabled ? 'success' : 'neutral'}>
          {invite.enabled ? text.pillOn : text.pillOff}
        </Badge>
      </h2>

      {invite.enabled && url !== null ? (
        <>
          <div className={styles['linkBox']}>
            <input
              className={styles['linkText']}
              readOnly
              value={url}
              aria-label={text.linkLabel}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" onClick={() => void copy(url)}>
              {text.copy}
            </Button>
          </div>
          <div className={styles['row']}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              {text.viewAsGuest}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              loading={busy === 'rotate'}
              aria-haspopup="dialog"
              onClick={() => setConfirmingRotate(true)}
            >
              {text.rotate}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={disabled}
              loading={busy === 'disable'}
              onClick={() => void act('disable', () => api.disableGuestInvite(slug), text.disabled)}
            >
              {text.disable}
            </Button>
          </div>
          <Notice tone="accent" variant="boxed">
            {text.openNote}
          </Notice>
        </>
      ) : (
        <>
          <p className={styles['note']}>{text.linkIntro}</p>
          {url !== null ? (
            <p className={styles['note']}>
              <NewTabLink href={url}>{text.viewAsGuest}</NewTabLink>
            </p>
          ) : null}
          {dated ? null : <p className={styles['note']}>{text.activateNeedsDate}</p>}
          <Button
            variant="primary"
            disabled={disabled || !dated}
            loading={busy === 'enable'}
            onClick={() => void act('enable', () => api.enableGuestInvite(slug), text.enabled)}
          >
            {text.activate}
          </Button>
        </>
      )}

      {problem === null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {problem}
        </Notice>
      )}

      <ConfirmDialog
        open={confirmingRotate}
        title={text.rotateTitle}
        description={text.rotateBody}
        confirmLabel={text.rotateConfirm}
        busy={busy === 'rotate'}
        onConfirm={() => void act('rotate', () => api.rotateGuestInviteToken(slug), text.rotated)}
        onCancel={() => setConfirmingRotate(false)}
      />
    </section>
  )
}
