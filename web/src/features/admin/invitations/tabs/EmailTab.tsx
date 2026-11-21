import { useMemo, useState } from 'react'
import { Button } from '../../../../design-system/components/Button'
import { Field } from '../../../../design-system/components/Field'
import { Notice } from '../../../../design-system/components/Notice'
import { Textarea } from '../../../../design-system/components/Textarea'
import { TextInput } from '../../../../design-system/components/TextInput'
import { copyToClipboard } from '../../../../lib/clipboard'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { graphemesOf } from '../../../../lib/invite/cardTexts'
import {
  MAILTO_MAX,
  SUBJECT_MAX,
  emailDraftOf,
  mailtoHref,
} from '../../../../lib/invite/emailDraft'
import { dayMonthLabel } from '../../../../lib/invite/inviteTexts'
import type { RenderPng } from './imageRender'
import { readInvitePreferences } from './invitePreferences'
import { ShotCard } from './ShotCard'
import type { InvitationTabProps } from './tabProps'
import { useInviteImage } from './useInviteImage'
import styles from './EmailTab.module.css'

export interface EmailTabProps extends InvitationTabProps {
  /** Makes the PNG to attach; the browser's own by default, a double in a component test. */
  readonly renderPng?: RenderPng
}

type Said = 'copied' | 'copyFailed' | null

/** The size of the attachment, in kilobytes; the unit is the reader's language's. */
const kilobytesOf = (bytes: number): number => Math.max(1, Math.round(bytes / 1024))

/**
 * The "E-mail" tab: a subject and a message ready to send from the host's own mailbox (spec 29).
 *
 * Surface: the host. **EventSlide sends nothing and keeps no address**: the link opens the host's
 * mail program on a draft to nobody, the host adds their guests in blind copy (the tab says so),
 * and the image to attach is made here, by the renderer of the image tab. The words are the
 * invitation's own (language, zone, the host's whole word) and editable for this time.
 */
export function EmailTab({ event, invite, renderPng }: EmailTabProps) {
  const t = useTranslations()
  const text = t.guestInvite.email
  const preferences = useMemo(() => readInvitePreferences(event.slug), [event.slug])
  const picture = useInviteImage({
    event,
    invite,
    preferences,
    shot: 'square',
    fileName: `${text.fileName}.png`,
    renderPng,
  })
  const { view } = picture

  const automatic = emailDraftOf(
    {
      title: view.texts.title,
      day: view.when.day,
      hours: view.when.hours,
      dayMonth: dayMonthLabel(new Date(invite.startsAt), view.lang, view.zone),
      venue: invite.venueName,
      address: invite.address,
      message: invite.message,
      url: invite.url,
    },
    view.lang,
  )
  // What the host rewrote is theirs only for the invitation it was written from: a new date, a new
  // place, a new word or a new link in the form is a new draft, and the old edit goes with it.
  const draftKey = `${automatic.subject}\u0000${automatic.body}`
  const [edits, setEdits] = useState<{
    readonly key: string
    readonly subject: string | null
    readonly body: string | null
  } | null>(null)
  const live = edits !== null && edits.key === draftKey ? edits : null
  const subject = live?.subject ?? automatic.subject
  const body = live?.body ?? automatic.body
  const link = mailtoHref({ subject, body }, invite.url, view.lang)
  const [said, setSaid] = useState<Said>(null)

  const edit = (patch: { subject?: string; body?: string }) => {
    setEdits({
      key: draftKey,
      subject: live?.subject ?? null,
      body: live?.body ?? null,
      ...patch,
    })
    setSaid(null)
  }
  const revert = () => {
    setEdits(null)
    setSaid(null)
  }

  const copy = async () => {
    setSaid((await copyToClipboard(`${subject}\n\n${body}`)) ? 'copied' : 'copyFailed')
  }

  const download = () => {
    if (picture.file === null) return
    const url = URL.createObjectURL(picture.file)
    const anchor = Object.assign(document.createElement('a'), {
      href: url,
      download: picture.file.name,
    })
    // Some browsers ignore a click on an anchor that is not in the page.
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  const busy = picture.image.status === 'rendering'

  return (
    <div className={styles['tab']}>
      <div className={styles['controls']}>
        <Field label={text.subjectLabel}>
          {(control) => (
            <TextInput
              {...control}
              value={subject}
              maxLength={SUBJECT_MAX}
              onChange={(e) =>
                edit({ subject: graphemesOf(e.target.value).slice(0, SUBJECT_MAX).join('') })
              }
            />
          )}
        </Field>
        <Field label={text.bodyLabel} hint={text.bodyNote}>
          {(control) => (
            <Textarea
              {...control}
              rows={10}
              grow={false}
              value={body}
              onChange={(e) => edit({ body: e.target.value })}
            />
          )}
        </Field>
        <p className={styles['counter']} data-cut={link.cut}>
          {text.counter(link.length, MAILTO_MAX)}
          {link.cut && link.wordLeft ? ` · ${text.counterCut}` : ''}
        </p>

        <div className={styles['actions']}>
          <a className={styles['open']} href={link.href}>
            {text.open}
          </a>
          <Button onClick={() => void copy()}>{text.copy}</Button>
          {live === null ? null : <Button onClick={revert}>{text.revertText}</Button>}
          <Button onClick={download} disabled={picture.file === null} aria-busy={busy}>
            {busy ? text.rendering : text.download}
          </Button>
        </div>

        {picture.image.status === 'failed' ? (
          <Notice tone="warning" role="alert" variant="boxed">
            {text.renderFailed} <Button onClick={picture.retry}>{text.retry}</Button>
          </Notice>
        ) : null}
        <div role="status" aria-live="polite">
          {said === null ? null : (
            <Notice tone={said === 'copyFailed' ? 'warning' : 'neutral'} variant="inline">
              {text[said]}
            </Notice>
          )}
        </div>
        <Notice tone="accent" variant="boxed">
          {text.bccAdvice}
        </Notice>
      </div>

      <section className={styles['preview']} aria-label={text.previewLabel}>
        <div className={styles['window']}>
          <p className={styles['windowTitle']}>{text.previewHeader}</p>
          <dl className={styles['headers']}>
            <div>
              <dt>{text.previewTo}</dt>
              <dd className={styles['hint']}>{text.previewToValue}</dd>
            </div>
            <div>
              <dt>{text.previewBcc}</dt>
              <dd className={styles['hint']}>{text.previewBccValue}</dd>
            </div>
            <div>
              <dt>{text.subjectLabel}</dt>
              <dd>{subject}</dd>
            </div>
          </dl>
          <p className={styles['message']}>{body}</p>
          <p className={styles['attachment']}>
            <span className={styles['chip']} aria-hidden="true" />
            {picture.file === null
              ? `${text.fileName}.png `
              : `${picture.file.name} · ${text.size(kilobytesOf(picture.file.size))} `}
            <span className={styles['hint']}>{text.attachmentNote}</span>
          </p>
        </div>
      </section>

      {/* The picture to attach is drawn out of sight, at its true size: it is what is captured. */}
      <div className={styles['offscreen']} aria-hidden="true" inert>
        <ShotCard
          view={view}
          eventName={event.name}
          url={invite.url}
          startsAt={invite.startsAt}
          shot="square"
          photoUrl={picture.photoUrl}
          backdropUrl={picture.backdropUrl}
          nodeRef={picture.node}
        />
      </div>
    </div>
  )
}
