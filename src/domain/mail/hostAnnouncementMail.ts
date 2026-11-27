import type { HostAnnouncementDraft } from '../hostAnnouncements/hostAnnouncement'
import type { EmailAddress } from '../users/emailAddress'
import type { OutgoingMail } from './outgoingMail'

/**
 * The mail of an announcement to the hosts (spec 32, A8). **The body is the operator's text, as written and untranslated**:
 * this adds nothing of its own but the optional link the operator gave (on a line of its own after a blank line) and the
 * product's name at the end. One recipient per mail, never an address in copy; `replyTo` is the operator's contact address
 * when it is configured, so a host can answer a change of terms.
 *
 * Pure: a function of its arguments.
 */
export const hostAnnouncementMail = ({
  to,
  announcement,
  replyTo,
}: {
  readonly to: EmailAddress
  readonly announcement: HostAnnouncementDraft
  readonly replyTo: EmailAddress | null
}): OutgoingMail => ({
  to,
  subject: announcement.subject,
  text: [
    announcement.text,
    ...(announcement.link === null ? [] : ['', announcement.link]),
    '',
    'EventSlide',
    '',
  ].join('\n'),
  ...(replyTo === null ? {} : { replyTo }),
})
