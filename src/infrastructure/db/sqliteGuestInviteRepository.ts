import { GuestInvite } from '../../domain/guestInvites/guestInvite'
import { restoreContent } from '../../domain/guestInvites/guestInviteContent'
import { GuestInviteToken } from '../../domain/guestInvites/guestInviteToken'
import { asEventId, type EventId } from '../../domain/shared/ids'
import type { GuestInviteRepository } from '../../application/ports/guestInviteRepository'
import type { Db } from './connection'
import { fromIsoText, toIsoText, toSqliteBoolean } from './rowMapping'

/**
 * `guest_invites` (spec 29): one row per event, found by event (the primary key) or by token
 * (the unique index). A lookup by token returns the row and **nothing of the event**.
 *
 * The content is read back through `restoreContent`, which never fails: a rule tightened later
 * must not make a printed invitation's page vanish. A stored token that no longer parses is a
 * corrupt row and throws.
 */

const COLUMNS = `event_id, token, enabled, title, starts_at, ends_at, time_zone, venue_name,
                 address, message, language, updated_at`

interface GuestInviteRow {
  readonly event_id: string
  readonly token: string
  readonly enabled: number
  readonly title: string | null
  readonly starts_at: string | null
  readonly ends_at: string | null
  readonly time_zone: string | null
  readonly venue_name: string | null
  readonly address: string | null
  readonly message: string | null
  readonly language: string
  readonly updated_at: string
}

const toGuestInvite = (row: GuestInviteRow): GuestInvite => {
  const token = GuestInviteToken.create(row.token)
  if (!token.ok) throw new Error(`guest_invites row ${row.event_id} has a corrupt token`)
  return GuestInvite.restore({
    eventId: asEventId(row.event_id),
    token: token.value,
    enabled: row.enabled === 1,
    // The CHECK on the column keeps the language valid; the fallback keeps the read total anyway.
    content: restoreContent(
      {
        title: row.title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        timeZone: row.time_zone,
        venueName: row.venue_name,
        address: row.address,
        message: row.message,
        language: row.language,
      },
      'fr',
    ),
    updatedAt: fromIsoText(row.updated_at),
  })
}

export class SqliteGuestInviteRepository implements GuestInviteRepository {
  constructor(private readonly db: Db) {}

  async findByEvent(eventId: EventId): Promise<GuestInvite | null> {
    const row = this.db
      .prepare<[string], GuestInviteRow>(`SELECT ${COLUMNS} FROM guest_invites WHERE event_id = ?`)
      .get(eventId)
    return row === undefined ? null : toGuestInvite(row)
  }

  async findByToken(token: GuestInviteToken): Promise<GuestInvite | null> {
    const row = this.db
      .prepare<[string], GuestInviteRow>(`SELECT ${COLUMNS} FROM guest_invites WHERE token = ?`)
      .get(token.value)
    return row === undefined ? null : toGuestInvite(row)
  }

  async save(invite: GuestInvite): Promise<void> {
    const { eventId, token, enabled, content, updatedAt } = invite.toProps()
    this.db
      .prepare(
        `INSERT INTO guest_invites (${COLUMNS})
              VALUES (@event_id, @token, @enabled, @title, @starts_at, @ends_at, @time_zone,
                      @venue_name, @address, @message, @language, @updated_at)
         ON CONFLICT (event_id) DO UPDATE SET
              token = excluded.token, enabled = excluded.enabled, title = excluded.title,
              starts_at = excluded.starts_at, ends_at = excluded.ends_at,
              time_zone = excluded.time_zone, venue_name = excluded.venue_name,
              address = excluded.address, message = excluded.message,
              language = excluded.language, updated_at = excluded.updated_at`,
      )
      .run({
        event_id: eventId,
        token: token.value,
        enabled: toSqliteBoolean(enabled),
        title: content.title,
        starts_at: content.startsAt === null ? null : toIsoText(content.startsAt),
        ends_at: content.endsAt === null ? null : toIsoText(content.endsAt),
        time_zone: content.timeZone,
        venue_name: content.venueName,
        address: content.address,
        message: content.message,
        language: content.language,
        updated_at: toIsoText(updatedAt),
      })
  }
}
