import { DomainError } from '../shared/errors'
import { toMultiLine, toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'

/**
 * An announcement the operator writes to the hosts (spec 32, A8): a change of terms, of a sub-processor, the end of the
 * service. **The operator's own words, in the language they choose: nothing is translated.**
 *
 * - **Subject**: one line, 1 to 150 characters (folded to one line like any typed subject: no header injection).
 * - **Text**: 1 to 5000 characters, line breaks kept, runs of blank lines folded.
 * - **Link**: optional, one `https://` address of at most 500 characters. It is the only link a mail of this family may carry.
 * - Never an address in copy: one mail per recipient (`hostAnnouncementMail` has one `to`).
 */

export const ANNOUNCEMENT_SUBJECT_MAX = 150
export const ANNOUNCEMENT_TEXT_MAX = 5000
export const ANNOUNCEMENT_LINK_MAX = 500
/** How long an announcement (the operator's text, kept as proof that hosts were told) is kept. */
export const ANNOUNCEMENT_KEPT_DAYS = 365
/** How long after it finished the record of who it was sent to is kept. */
export const ANNOUNCEMENT_DELIVERIES_KEPT_DAYS = 30

export interface HostAnnouncementDraft {
  readonly subject: string
  readonly text: string
  readonly link: string | null
}

export interface HostAnnouncement extends HostAnnouncementDraft {
  readonly id: string
  /** Who wrote it, `null` once that account is gone. */
  readonly createdBy: string | null
  readonly createdAt: Date
  /** When the last recipient was reached, `null` while it is going out. */
  readonly finishedAt: Date | null
}

const length = (value: string): number => [...value].length

/**
 * `https://host.tld/...`: a host name made of labels, an optional port, an optional path, query or fragment with no space,
 * and **no credentials** (`user:pass@` does not match a host name). Judged by a pattern: the domain has no URL parser.
 */
const HTTPS_LINK =
  /^https:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/u

const parseLink = (raw: string): Result<string | null, DomainError> => {
  const trimmed = raw.trim()
  if (trimmed === '') return ok(null)
  if (length(trimmed) > ANNOUNCEMENT_LINK_MAX || !HTTPS_LINK.test(trimmed)) {
    return err(DomainError.invalid('hostAnnouncement.linkInvalid'))
  }
  return ok(trimmed)
}

export const parseHostAnnouncement = (input: {
  readonly subject: string
  readonly text: string
  readonly link?: string | undefined
}): Result<HostAnnouncementDraft, DomainError> => {
  const subject = toSingleLine(input.subject)
  if (subject.length === 0 || length(subject) > ANNOUNCEMENT_SUBJECT_MAX) {
    return err(DomainError.invalid('hostAnnouncement.subjectInvalid'))
  }
  const text = toMultiLine(input.text)
  if (text.length === 0 || length(text) > ANNOUNCEMENT_TEXT_MAX) {
    return err(DomainError.invalid('hostAnnouncement.textInvalid'))
  }
  const link = parseLink(input.link ?? '')
  if (!link.ok) return link
  return ok({ subject, text, link: link.value })
}
