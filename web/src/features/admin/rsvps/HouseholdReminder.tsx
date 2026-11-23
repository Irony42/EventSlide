import { useState, type ReactNode } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { Textarea } from '../../../design-system/components/Textarea'
import { useToast } from '../../../design-system/components/useToast'
import type { HouseholdDto } from '../../../lib/api/dto'
import { copyToClipboard } from '../../../lib/clipboard'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  householdLink,
  mailtoUrl,
  reminderMessage,
  smsUrl,
  whatsappUrl,
} from '../../../lib/rsvp/households'
import styles from './HouseholdsPage.module.css'

/** What the page knows of the invitation, which the reminder's links depend on. */
export type ReminderInvite =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly retry: () => void }
  /** No invitation saved yet, or none with an address. */
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly url: string; readonly title: string }

export interface HouseholdReminderProps {
  /** The households with no reply, in the list's order. */
  readonly pending: readonly HouseholdDto[]
  readonly invite: ReminderInvite
  /** The deadline as a date in the host's language, or `null`. */
  readonly deadline: string | null
  /** Notes "relancé" for a household; a refusal is the page's to say. */
  readonly onReminded: (household: HouseholdDto) => Promise<void>
  /** An archived event is read-only: the note cannot be written, so nothing is offered. */
  readonly archived: boolean
  /** Changes each time the host asks to remind them all: the panel starts again from the first. */
  readonly startSignal: number
}

/**
 * "Relance guidée" (spec 30, lot 3): one household without a reply at a time, a message the host may
 * edit, and four ways to send it **from the host's own applications**: WhatsApp, SMS and e-mail open
 * with the message ready and **no recipient** (EventSlide knows no number and no address), or the
 * message is copied. Using one notes "relancé" for that household (as soon as a channel is clicked, or
 * once the copy succeeded), and the host moves on to the next.
 *
 * The panel **follows a household, not a position**: when the list is read again and the household
 * on screen has answered, the panel moves to the one now at its place. An edit is kept per household
 * **and per link, title and deadline**, so a household whose link was changed gets a fresh message
 * and never one that carries the revoked link.
 */
export function HouseholdReminder({
  pending,
  invite,
  deadline,
  onReminded,
  archived,
  startSignal,
}: HouseholdReminderProps) {
  const t = useTranslations()
  const text = t.rsvp.households
  const toast = useToast()
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  // The household on screen and where it stands: if it answers meanwhile, the panel stays at that place.
  const [cursor, setCursor] = useState<{ readonly id: string | null; readonly at: number }>({
    id: null,
    at: 0,
  })
  const [seenSignal, setSeenSignal] = useState(startSignal)

  if (seenSignal !== startSignal) {
    setSeenSignal(startSignal)
    setCursor({ id: null, at: 0 })
  }

  const panel = (body: ReactNode) => (
    <section className={styles['reminder']} aria-label={text.reminderTitle}>
      <h2>{text.reminderTitle}</h2>
      {body}
    </section>
  )
  if (pending.length === 0) return panel(<p className={styles['note']}>{text.reminderAllDone}</p>)
  if (archived) return panel(<p className={styles['note']}>{text.reminderArchived}</p>)
  if (invite.kind === 'loading')
    return panel(<p className={styles['note']}>{text.reminderLoading}</p>)
  if (invite.kind === 'error') {
    return panel(
      <>
        <Notice tone="warning" variant="inline">
          {text.reminderInviteFailed}
        </Notice>
        <Button size="sm" onClick={invite.retry}>
          {text.retry}
        </Button>
      </>,
    )
  }
  if (invite.kind === 'none') {
    return panel(
      <Notice tone="warning" variant="inline">
        {text.reminderNoLink}
      </Notice>,
    )
  }

  const found = pending.findIndex((household) => household.id === cursor.id)
  const at = found >= 0 ? found : Math.min(cursor.at, pending.length - 1)
  const household = pending[at] as HouseholdDto
  if (cursor.id !== household.id || cursor.at !== at) setCursor({ id: household.id, at })
  const link = householdLink(invite.url, household) as string
  const context = { title: invite.title, deadline, link }
  const draftKey = `${household.id}|${household.token}|${invite.title}|${deadline ?? ''}`
  const message = drafts[draftKey] ?? reminderMessage(household, context, text)
  const used = () => void onReminded(household)
  const go = (next: number) => setCursor({ id: (pending[next] as HouseholdDto).id, at: next })

  return panel(
    <>
      <p className={styles['progress']}>{text.reminderProgress(at + 1, pending.length)}</p>
      <p className={styles['who']}>{household.name}</p>
      <Field label={`${text.reminderMessageLabel} (${text.reminderEditable})`}>
        {(control) => (
          <Textarea
            {...control}
            rows={6}
            value={message}
            onChange={(event) => setDrafts({ ...drafts, [draftKey]: event.target.value })}
          />
        )}
      </Field>
      <div className={styles['channels']}>
        <a
          className={styles['channel']}
          data-primary="true"
          href={whatsappUrl(message)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={used}
        >
          {text.reminderWhatsapp}
        </a>
        <a className={styles['channel']} href={smsUrl(message)} onClick={used}>
          {text.reminderSms}
        </a>
        <a
          className={styles['channel']}
          href={mailtoUrl(text.reminderSubject(invite.title), message)}
          onClick={used}
        >
          {text.reminderEmail}
        </a>
        <Button
          size="sm"
          onClick={() => {
            void copyToClipboard(message).then((copied) => {
              toast.show(copied ? text.reminderCopied : text.copyFailed(message), {
                tone: copied ? 'success' : 'warning',
              })
              // Only a copy that worked is a reminder that can be sent.
              if (copied) used()
            })
          }}
        >
          {text.reminderCopy}
        </Button>
      </div>
      <div className={styles['steps']}>
        <Button variant="ghost" size="sm" disabled={at === 0} onClick={() => go(at - 1)}>
          {text.reminderPrevious}
        </Button>
        <Button size="sm" disabled={at >= pending.length - 1} onClick={() => go(at + 1)}>
          {text.reminderNext}
        </Button>
      </div>
      <p className={styles['note']}>
        {text.reminderNote} {text.reminderNoteMarked}
      </p>
    </>,
  )
}
