import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { PASSWORD_MIN_LENGTH } from '../auth/passwordPolicy'
import { Async } from '../../design-system/components/Async'
import { SelectField } from './components/SelectField'
import { useShareLink } from './hooks/useEventData'
import { useCreateShareLink, useRevokeShareLink } from './hooks/useEventActions'
import { useLeaveWarning } from './hooks/useLeaveWarning'
import styles from './ShareLinkPanel.module.css'
import type { ShareLinkCreated } from '../../lib/api/dto'

export interface ShareLinkPanelProps {
  readonly slug: string
  /** Lets the "After the evening" card take the host to this panel. */
  readonly titleRef?: RefObject<HTMLHeadingElement | null>
}

/**
 * The lifetimes offered. A closed set, for the reason `SelectField` gives: the server holds
 * the bounds (one to ninety days) and every option here is one it accepts, so nothing on
 * this screen restates a limit it could drift from.
 */
const LIFETIMES = [7, 30, 90] as const
const DEFAULT_LIFETIME = 30

/**
 * The link a host sends after the event (roadmap §4.1): make it, see whether it still
 * opens, take it back.
 *
 * Owner only, like every endpoint behind it, so the page mounts it for an owner and a
 * moderator is never shown three buttons that would all come back 403.
 *
 * **The address is shown once.** The server stores the token's digest and nothing it could
 * turn back into the URL, so the answer to "make a link" is the only time the address
 * exists outside the host's own message — this panel keeps it on screen, with a copy
 * button, until the host leaves the page, and says so.
 *
 * **So losing it has to be hard.** A copy the browser refuses says so, in words, and leaves the
 * address selected in its field to copy by hand. And while the address is on screen and nothing
 * has copied it, leaving the page asks first (`useLeaveWarning`): once it has been copied it
 * exists elsewhere (the host's message, their clipboard), and the question would only be noise.
 * That is the whole check: a link shown and never copied, because this page is the only place
 * it is ever shown.
 */
export function ShareLinkPanel({ slug, titleRef }: ShareLinkPanelProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const shareLink = useShareLink(slug)
  const { reload } = shareLink
  const create = useCreateShareLink()
  const revoke = useRevokeShareLink()
  const toast = useToast()

  const [lifetime, setLifetime] = useState<number>(DEFAULT_LIFETIME)
  const [password, setPassword] = useState('')
  const [createFailure, setCreateFailure] = useState<string | null>(null)
  const [created, setCreated] = useState<ShareLinkCreated | null>(null)
  /** The address left this page: the copy button worked, or the host copied it by hand. */
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const urlField = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState(false)

  const link = shareLink.data?.link ?? null

  useLeaveWarning(created !== null && !copied, t.admin.shareLinkLeaveWarning)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateFailure(null)
    // Not trimmed: a passphrase's spaces are part of it, and the one the host passes on
    // must be the one that was stored.
    void create.run('create', slug, { expiresInDays: lifetime, password }).then((result) => {
      if (!result.ok) {
        setCreateFailure(result.message)
        return
      }
      setCreated(result.value)
      setCopied(false)
      setCopyFailed(false)
      setPassword('')
      reload()
    })
  }

  const copy = () => {
    if (created === null) return
    const refused = () => {
      // The address is in the field beside this button: selected, so the host's own Ctrl+C (or a
      // long-press) finishes what the browser would not, and the failure is said out loud.
      setCopyFailed(true)
      urlField.current?.focus()
      urlField.current?.select()
    }
    // No clipboard at all (an insecure origin, an old browser) is the same failure as a refusal.
    if (navigator.clipboard === undefined) {
      refused()
      return
    }
    void navigator.clipboard.writeText(created.url).then(() => {
      setCopied(true)
      setCopyFailed(false)
      toast.show(t.admin.shareLinkCopied, { tone: 'success' })
    }, refused)
  }

  const confirmRevoke = () => {
    void revoke.run('revoke', slug).then((result) => {
      setConfirming(false)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      setCreated(null)
      setCopyFailed(false)
      toast.show(t.admin.shareLinkRevoked, { tone: 'success' })
      reload()
    })
  }

  const until = link === null ? null : formatDateTime(link.expiresAt, locale)

  return (
    <Card as="h2" title={t.admin.shareLink} subtitle={t.admin.shareLinkHint} titleRef={titleRef}>
      <Async state={shareLink} as="h3">
        {() => (
          <div className={styles['status']} role="status">
            {link === null ? (
              <p className={styles['none']}>{t.admin.shareLinkNone}</p>
            ) : (
              <>
                <p className={link.available ? styles['open'] : styles['closed']}>
                  {link.available
                    ? t.admin.shareLinkActive(until ?? link.expiresAt)
                    : t.admin.shareLinkUnavailable}
                </p>
                <Badge tone={link.hasPassword ? 'accent' : 'neutral'}>
                  {link.hasPassword ? t.admin.shareLinkProtected : t.admin.shareLinkUnprotected}
                </Badge>
              </>
            )}
          </div>
        )}
      </Async>

      {created === null ? null : (
        <div className={styles['created']}>
          <p>{t.admin.shareLinkCreated}</p>
          <Field label={t.admin.shareLinkUrl}>
            {(control) => (
              <TextInput
                {...control}
                ref={urlField}
                readOnly
                value={created.url}
                onFocus={(focused) => focused.target.select()}
                // A hand copy counts: the address has left this page.
                onCopy={() => setCopied(true)}
              />
            )}
          </Field>
          {copyFailed ? <p role="alert">{t.admin.shareLinkCopyFailed}</p> : null}
          <div className={styles['actions']}>
            <Button variant="primary" onClick={copy}>
              {t.admin.shareLinkCopy}
            </Button>
          </div>
        </div>
      )}

      <form className={styles['form']} onSubmit={submit} noValidate>
        <SelectField
          label={t.admin.shareLinkLifetime}
          value={String(lifetime)}
          options={LIFETIMES.map((days) => ({
            value: String(days),
            label: t.admin.shareLinkDays(days),
          }))}
          onChange={(value) => setLifetime(Number(value))}
        />
        <Field
          label={t.admin.shareLinkPassword}
          hint={t.admin.shareLinkPasswordHint(PASSWORD_MIN_LENGTH)}
          optional
          {...(createFailure === null ? {} : { error: createFailure })}
        >
          {(control) => (
            <TextInput
              {...control}
              type="password"
              name="shareLinkPassword"
              // `new-password`: the host is choosing a password for their guests, and
              // offering their own saved one here would be the worst possible autofill.
              autoComplete="new-password"
              value={password}
              onChange={(changed) => setPassword(changed.target.value)}
            />
          )}
        </Field>
        {link === null ? null : <p className={styles['hint']}>{t.admin.shareLinkReplaceHint}</p>}
        <div className={styles['actions']}>
          <Button
            type="submit"
            variant={link === null ? 'primary' : 'secondary'}
            loading={create.busy}
          >
            {link === null ? t.admin.shareLinkCreate : t.admin.shareLinkReplace}
          </Button>
          {link === null ? null : (
            <Button
              variant="danger"
              loading={revoke.busy}
              onClick={() => setConfirming(true)}
              aria-haspopup="dialog"
            >
              {t.admin.shareLinkRevoke}
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirming}
        title={t.admin.shareLinkRevokeTitle}
        description={t.admin.shareLinkRevokeHint}
        confirmLabel={t.admin.shareLinkRevoke}
        busy={revoke.busy}
        onConfirm={confirmRevoke}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  )
}
