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
 * - **Write-ahead, one line, a number**: `account.hostAnnouncementSent` is recorded before the announcement exists, and says how
 *   many accounts, never the text and never an address.
 */

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
  readonly announcements: Pick<HostAnnouncementRepository, 'create' | 'countRecipients'>
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
    const entry = AuditEntry.create({
      at,
      actor: { kind: 'operator', userId: operatorId },
      action: 'account.hostAnnouncementSent',
      subject: { type: 'account', id: operatorId },
      clientId: null,
      details: { recipients },
    })
    if (!entry.ok) return entry
    await audit.record(entry.value)

    const announcement: HostAnnouncement = {
      ...draft.value,
      id: ids.hostAnnouncementId(),
      createdBy: operatorId,
      createdAt: at,
      finishedAt: null,
    }
    await announcements.create(announcement)
    try {
      kick?.()
    } catch {
      // The next pass of the sweep starts it: a failure to start early is not the operator's business.
    }
    return ok({ id: announcement.id, recipients })
  }
