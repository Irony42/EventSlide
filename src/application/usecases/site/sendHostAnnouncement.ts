import { AuditEntry } from '../../../domain/audit/auditEntry'
import {
  parseHostAnnouncement,
  type HostAnnouncement,
} from '../../../domain/hostAnnouncements/hostAnnouncement'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { HostAnnouncementRepository } from '../../ports/hostAnnouncementRepository'
import type { Mailer } from '../../ports/mailer'

/**
 * Writes an announcement to the hosts (spec 32, lot 2, A8): `POST /api/site/announcements`, behind the operator's gate, a second
 * factor and a step-up, like every write of the console.
 *
 * It **writes the announcement and sends nothing itself**: the mails go out by batches, within the day's budget, from the
 * retention sweep (`sweepHostAnnouncements`), which a restart resumes and which never writes to an account twice. What this
 * answers is the announcement's id and **how many accounts it is owed to** (the active owners of at least one client), so the
 * operator sees the size of what they just started. `kick`, when it is given, starts the first batch without waiting for the
 * next pass; it is never awaited and never throws.
 *
 * - **A box that cannot mail refuses** (`409 hostAnnouncement.mailerRequired`): an announcement nobody could receive would sit
 *   unfinished for ever. **Nobody to write to** is `409 hostAnnouncement.noRecipients`.
 * - **The same words twice are refused** (`409 hostAnnouncement.duplicate`): an announcement with the same subject, text and link
 *   written in the last {@link DUPLICATE_WINDOW_MS} or still going out.
 * - **One line, a number**: `account.hostAnnouncementSent` is recorded once the announcement is written (the entry is built and
 *   judged first, so an actor the log would refuse writes nothing), and says how many accounts, never the text and never an
 *   address.
 */

/** How long the same words are taken for the same announcement: ten minutes. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000

export interface SendHostAnnouncementInput {
  readonly subject: string
  readonly text: string
  readonly link?: string | undefined
  /** The operator writing it. */
  readonly operatorId: UserId
}

export interface SentHostAnnouncement {
  readonly id: string
  /** How many accounts it is owed to, when it was written. */
  readonly recipients: number
}

export interface SendHostAnnouncementDeps {
  readonly announcements: Pick<
    HostAnnouncementRepository,
    'create' | 'countRecipients' | 'existsDuplicate'
  >
  readonly audit: AuditRecorder
  readonly ids: Pick<IdGenerator, 'hostAnnouncementId'>
  readonly clock: Clock
  readonly mailer: Pick<Mailer, 'canDeliver'>
  /** Starts the first batch at once. Optional: absent, the next pass of the sweep starts it. */
  readonly kick?: () => void
}

export type SendHostAnnouncement = (
  input: SendHostAnnouncementInput,
) => Promise<Result<SentHostAnnouncement, DomainError>>

export const makeSendHostAnnouncement =
  ({
    announcements,
    audit,
    ids,
    clock,
    mailer,
    kick,
  }: SendHostAnnouncementDeps): SendHostAnnouncement =>
  async ({ subject, text, link, operatorId }) => {
    const draft = parseHostAnnouncement({ subject, text, link })
    if (!draft.ok) return draft
    if (!mailer.canDeliver) return err(DomainError.conflict('hostAnnouncement.mailerRequired'))

    const recipients = await announcements.countRecipients()
    if (recipients === 0) return err(DomainError.conflict('hostAnnouncement.noRecipients'))

    const at = clock.now()
    // A double click, a retry after a timeout, a second tab: the same words, written a moment ago or still going out, are the
    // same announcement, and every host would be mailed twice.
    const since = new Date(at.getTime() - DUPLICATE_WINDOW_MS)
    if (await announcements.existsDuplicate(draft.value, since)) {
      return err(DomainError.conflict('hostAnnouncement.duplicate'))
    }

    const entry = AuditEntry.create({
      at,
      actor: { kind: 'operator', userId: operatorId },
      action: 'account.hostAnnouncementSent',
      subject: { type: 'account', id: operatorId },
      clientId: null,
      details: { recipients },
    })
    if (!entry.ok) return entry

    const announcement: HostAnnouncement = {
      ...draft.value,
      id: ids.hostAnnouncementId(),
      createdBy: operatorId,
      createdAt: at,
      finishedAt: null,
    }
    await announcements.create(announcement)
    // After the announcement exists: a line for an announcement that was never written would say something that did not happen.
    await audit.record(entry.value)
    try {
      kick?.()
    } catch {
      // The next pass of the sweep starts it: a failure to start early is not the operator's business.
    }
    return ok({ id: announcement.id, recipients })
  }
