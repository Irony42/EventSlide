import { GuestInvite } from '../../domain/guestInvites/guestInvite'
import {
  restoreContent,
  type GuestInviteContent,
} from '../../domain/guestInvites/guestInviteContent'
import { GuestInviteToken } from '../../domain/guestInvites/guestInviteToken'
import { restoreRsvpForm } from '../../domain/guestRsvps/rsvpForm'
import type { RsvpSettings } from '../../domain/guestRsvps/rsvpSettings'
import { asEventId, type EventId } from '../../domain/shared/ids'
import type { GuestInviteRepository } from '../../application/ports/guestInviteRepository'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText, toSqliteBoolean } from './rowMapping'

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

const contentParams = (content: GuestInviteContent) => ({
  title: content.title,
  starts_at: content.startsAt === null ? null : toIsoText(content.startsAt),
  ends_at: content.endsAt === null ? null : toIsoText(content.endsAt),
  time_zone: content.timeZone,
  venue_name: content.venueName,
  address: content.address,
  message: content.message,
  language: content.language,
})

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

  async create(invite: GuestInvite): Promise<void> {
    const { eventId, token, enabled, content, updatedAt } = invite.toProps()
    this.db
      .prepare(
        `INSERT INTO guest_invites (${COLUMNS})
              VALUES (@event_id, @token, @enabled, @title, @starts_at, @ends_at, @time_zone,
                      @venue_name, @address, @message, @language, @updated_at)`,
      )
      .run({
        event_id: eventId,
        token: token.value,
        enabled: toSqliteBoolean(enabled),
        ...contentParams(content),
        updated_at: toIsoText(updatedAt),
      })
  }

  /** Content and `updated_at` only: the statement does not name `token` or `enabled`. */
  async saveContent(invite: GuestInvite): Promise<void> {
    const { eventId, content, updatedAt } = invite.toProps()
    this.db
      .prepare(
        `UPDATE guest_invites
            SET title = @title, starts_at = @starts_at, ends_at = @ends_at, time_zone = @time_zone,
                venue_name = @venue_name, address = @address, message = @message,
                language = @language, updated_at = @updated_at
          WHERE event_id = @event_id`,
      )
      .run({ event_id: eventId, ...contentParams(content), updated_at: toIsoText(updatedAt) })
  }

  async setEnabled(eventId: EventId, enabled: boolean, at: Date): Promise<void> {
    this.db
      .prepare<[number, string, string]>(
        `UPDATE guest_invites SET enabled = ?, updated_at = ? WHERE event_id = ?`,
      )
      .run(toSqliteBoolean(enabled), toIsoText(at), eventId)
  }

  async findRsvpSettings(eventId: EventId): Promise<RsvpSettings | null> {
    const row = this.db
      .prepare<
        [string],
        {
          readonly rsvp_enabled: number
          readonly rsvp_deadline: string | null
          readonly rsvp_closed_at: string | null
          readonly rsvp_form: string | null
        }
      >(
        `SELECT rsvp_enabled, rsvp_deadline, rsvp_closed_at, rsvp_form
           FROM guest_invites WHERE event_id = ?`,
      )
      .get(eventId)
    if (row === undefined) return null
    return {
      enabled: row.rsvp_enabled === 1,
      deadline: row.rsvp_deadline,
      closedAt: fromNullableIsoText(row.rsvp_closed_at),
      // The column carries `CHECK (json_valid(rsvp_form))`; the restore is lenient on its shape.
      form: restoreRsvpForm(row.rsvp_form === null ? null : (JSON.parse(row.rsvp_form) as unknown)),
    }
  }

  /** The switch, the deadline and the form: the statement names neither the closing nor the text. */
  async saveRsvpSettings(eventId: EventId, settings: RsvpSettings): Promise<void> {
    this.db
      .prepare<[number, string | null, string, string]>(
        `UPDATE guest_invites SET rsvp_enabled = ?, rsvp_deadline = ?, rsvp_form = ? WHERE event_id = ?`,
      )
      .run(
        toSqliteBoolean(settings.enabled),
        settings.deadline,
        JSON.stringify(settings.form),
        eventId,
      )
  }

  async eventsWithRsvpDeadlineBetween(fromDay: string, toDay: string): Promise<readonly EventId[]> {
    return this.db
      .prepare<[string, string], { readonly event_id: string }>(
        `SELECT event_id FROM guest_invites
          WHERE rsvp_enabled = 1 AND rsvp_closed_at IS NULL
            AND rsvp_deadline IS NOT NULL AND rsvp_deadline BETWEEN ? AND ?
          ORDER BY event_id`,
      )
      .all(fromDay, toDay)
      .map((row) => asEventId(row.event_id))
  }

  async eventsWithRsvpCapacity(): Promise<readonly EventId[]> {
    return this.db
      .prepare<[], { readonly event_id: string }>(
        `SELECT event_id FROM guest_invites
          WHERE rsvp_enabled = 1 AND rsvp_closed_at IS NULL
            AND rsvp_form IS NOT NULL AND json_extract(rsvp_form, '$.capacity') IS NOT NULL
          ORDER BY event_id`,
      )
      .all()
      .map((row) => asEventId(row.event_id))
  }

  async setRsvpClosedAt(eventId: EventId, closedAt: Date | null): Promise<void> {
    this.db
      .prepare<[string | null, string]>(
        `UPDATE guest_invites SET rsvp_closed_at = ? WHERE event_id = ?`,
      )
      .run(closedAt === null ? null : toIsoText(closedAt), eventId)
  }

  async rotateToken(eventId: EventId, token: GuestInviteToken, at: Date): Promise<void> {
    this.db
      .prepare<[string, string, string]>(
        `UPDATE guest_invites SET token = ?, updated_at = ? WHERE event_id = ?`,
      )
      .run(token.value, toIsoText(at), eventId)
  }
}
