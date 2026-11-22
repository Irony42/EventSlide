import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
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
  /** The switch-on button, for the page to press from the locked state's own step. */
  readonly activateRef?: RefObject<HTMLButtonElement | null>
}

/**
 * The link's status as a bar under the page's title: "Invitation active · link · Copier ·
 * Changer le lien · Désactiver", or the reason it is off and the way to switch it on.
 *
 * Surface: the host (the owner). **Every act is the server's**: whether there is a date to
 * announce, what the link is now, whether it was already on. This shows the answer. Changing the
 * link asks first and says what it costs (the printed QR codes and the links already sent stop
 * working); switching off is not destructive (the same link comes back), so it asks nothing.
 */
export function InvitationLink({
  slug,
  invite,
  disabled,
  onChanged,
  activateRef,
}: InvitationLinkProps) {
  const t = useTranslations()
  const text = t.guestInvite.host
  const api = useApi()
  const toast = useToast()
  const [busy, setBusy] = useState<'enable' | 'disable' | 'rotate' | null>(null)
  const [confirmingRotate, setConfirmingRotate] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const linkField = useRef<HTMLInputElement>(null)
  const ownActivate = useRef<HTMLButtonElement>(null)
  const activateButton = activateRef ?? ownActivate
  // Where the focus goes once the answer is on screen: the button that was pressed is gone by then
  // (switching on replaces it by the link, switching off the link by the button), and focus on a
  // removed control falls to the page.
  const focusAfter = useRef<'link' | 'activate' | null>(null)

  useEffect(() => {
    if (focusAfter.current === 'link') linkField.current?.focus()
    if (focusAfter.current === 'activate') activateButton.current?.focus()
    focusAfter.current = null
  }, [invite.enabled, activateButton])

  const act = async (
    which: 'enable' | 'disable' | 'rotate',
    call: () => Promise<{ readonly guestInvite: GuestInviteDto }>,
    done: string,
  ) => {
    setBusy(which)
    setProblem(null)
    try {
      const answer = await call()
      focusAfter.current = which === 'enable' ? 'link' : which === 'disable' ? 'activate' : null
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
  // A saved start is what the server will accept: the form may hold one not saved yet.
  const dated = invite.startsAt !== null

  return (
    <section className={styles['bar']} aria-label={text.statusBarLabel} data-on={invite.enabled}>
      <p className={styles['status']}>
        <span className={styles['dot']} aria-hidden="true" />
        <span>{invite.enabled && url !== null ? text.statusOn : text.statusOff}</span>
      </p>

      {invite.enabled && url !== null ? (
        <>
          <input
            className={styles['linkText']}
            readOnly
            value={url}
            ref={linkField}
            aria-label={text.linkLabel}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className={styles['barActions']}>
            <Button size="sm" onClick={() => void copy(url)}>
              {text.copy}
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
        </>
      ) : (
        <>
          <p className={styles['reason']}>{dated ? text.linkIntro : text.activateNeedsDate}</p>
          <div className={styles['barActions']}>
            <Button
              ref={activateButton}
              variant="primary"
              size="sm"
              disabled={disabled || !dated}
              loading={busy === 'enable'}
              onClick={() => void act('enable', () => api.enableGuestInvite(slug), text.enabled)}
            >
              {text.activate}
            </Button>
          </div>
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
