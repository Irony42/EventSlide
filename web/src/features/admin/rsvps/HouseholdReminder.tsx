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

export interface HouseholdReminderProps {
  /** The households with no reply, in the list's order. */
  readonly pending: readonly HouseholdDto[]
  /** Where the host stands in `pending` (clamped: the list shrinks as households answer). */
  readonly index: number
  readonly onIndex: (index: number) => void
  /** The invitation's address, or `null` while it has none. */
  readonly inviteUrl: string | null
  readonly title: string
  /** The deadline as a date in the host's language, or `null`. */
  readonly deadline: string | null
  /** Notes "relancé" for a household; a refusal is the page's to say. */
  readonly onReminded: (household: HouseholdDto) => Promise<void>
}

/**
 * "Relance guidée" (spec 30, lot 3): one household without a reply at a time, a message the host may
 * edit, and four ways to send it **from the host's own applications**: WhatsApp, SMS and e-mail open
 * with the message ready and **no recipient** (EventSlide knows no number and no address), or the
 * message is copied. Using one notes "relancé" for that household, and the host moves on to the next.
 *
 * Nothing is sent by EventSlide, so nothing here can fail but the host's own note.
 */
export function HouseholdReminder({
  pending,
  index,
  onIndex,
  inviteUrl,
  title,
  deadline,
  onReminded,
}: HouseholdReminderProps) {
  const t = useTranslations()
  const text = t.rsvp.households
  const toast = useToast()
  // What the host edited, per household: moving on and back keeps it.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})

  const panel = (body: ReactNode) => (
    <section className={styles['reminder']} aria-label={text.reminderTitle}>
      <h2>{text.reminderTitle}</h2>
      {body}
    </section>
  )
  if (pending.length === 0) return panel(<p className={styles['note']}>{text.reminderAllDone}</p>)

  const at = Math.min(Math.max(index, 0), pending.length - 1)
  const household = pending[at] as HouseholdDto
  const link = householdLink(inviteUrl, household)
  if (link === null) {
    return panel(
      <Notice tone="warning" variant="inline">
        {text.reminderNoLink}
      </Notice>,
    )
  }
  const message =
    drafts[household.id] ?? reminderMessage(household, { title, deadline, link }, text)
  const used = () => void onReminded(household)

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
            onChange={(event) => setDrafts({ ...drafts, [household.id]: event.target.value })}
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
          href={mailtoUrl(text.reminderSubject(title), message)}
          onClick={used}
        >
          {text.reminderEmail}
        </a>
        <Button
          size="sm"
          onClick={() => {
            void copyToClipboard(message).then((copied) =>
              toast.show(copied ? text.reminderCopied : text.copyFailed(message), {
                tone: copied ? 'success' : 'warning',
              }),
            )
            used()
          }}
        >
          {text.reminderCopy}
        </Button>
      </div>
      <div className={styles['steps']}>
        <Button variant="ghost" size="sm" disabled={at === 0} onClick={() => onIndex(at - 1)}>
          {text.reminderPrevious}
        </Button>
        <Button size="sm" disabled={at >= pending.length - 1} onClick={() => onIndex(at + 1)}>
          {text.reminderNext}
        </Button>
      </div>
      <p className={styles['note']}>{text.reminderNote}</p>
    </>,
  )
}
