import type {
  SignupAdmitInput,
  SignupAdmitResult,
  SignupConfirmInput,
  SignupConfirmResult,
  SignupConfirmationPeek,
  SignupFinalization,
  SignupListFilter,
  SignupRepository,
  SignupSweepResult,
} from '../../application/ports/signupRepository'
import { ClientName } from '../../domain/clients/clientName'
import { isClientLocale } from '../../domain/clients/clientLocale'
import { asAccountTokenId, asClientId, asUserId, type UserId } from '../../domain/shared/ids'
import {
  decideSignupAdmission,
  type AddressRequestView,
} from '../../domain/signups/signupAdmission'
import {
  confirmSignupRequest,
  isSignupStatus,
  type SignupRequest,
  type SignupStatus,
} from '../../domain/signups/signupRequest'
import {
  SIGNUP_PENDING_EXPIRES_AFTER_DAYS,
  signupSweepAction,
} from '../../domain/signups/signupRetention'
import { EmailAddress } from '../../domain/users/emailAddress'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'
import { ACCOUNT_TOKEN_USABLE_SQL } from './sqliteAccountTokenRepository'

/**
 * `signup_requests` (migration 041), and, in the same transactions, the confirmation tokens in
 * `account_tokens` (purpose `emailVerification`, no account).
 *
 * **Every transition is one conditional `UPDATE ... WHERE status = <the state it leaves>`**, and
 * `better-sqlite3` is synchronous, so the second of two callers finds the row already moved and gets
 * `changes === 0`. `admit` and `confirm` are one `immediate` transaction each: what they count and what
 * they write cannot be split by another request.
 *
 * Sweeping applies the **domain's** `signupSweepAction` to the rows rather than restating its dates in
 * SQL, so the retention rule has one definition. The table holds at most 50 a day for 60 days.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** A `pending` request made at or before this instant is past its 30 days: nobody may decide it. */
const pendingCutoff = (now: Date): string =>
  toIsoText(new Date(now.getTime() - SIGNUP_PENDING_EXPIRES_AFTER_DAYS * DAY_MS))

const COLUMNS = `id, email, client_name, note, event_date, locale, status, created_at, confirmed_at,
                 claimed_at, decided_at, decided_by, client_id, invitation_token_id`

const QUALIFIED_COLUMNS = COLUMNS.split(',')
  .map((column) => `s.${column.trim()}`)
  .join(', ')

interface SignupRow {
  readonly id: string
  readonly email: string
  readonly client_name: string
  readonly note: string | null
  readonly event_date: string | null
  readonly locale: string
  readonly status: string
  readonly created_at: string
  readonly confirmed_at: string | null
  readonly claimed_at: string | null
  readonly decided_at: string | null
  readonly decided_by: string | null
  readonly client_id: string | null
  readonly invitation_token_id: string | null
}

const corrupt = (column: string, value: string): Error =>
  new Error(`signup_requests.${column} holds a value the domain rejects (${value})`)

const toRequest = (row: SignupRow): SignupRequest => {
  const email = EmailAddress.fromStored(row.email)
  if (!email.ok) throw corrupt('email', email.error.code)
  const clientName = ClientName.create(row.client_name)
  if (!clientName.ok) throw corrupt('client_name', clientName.error.code)
  if (!isClientLocale(row.locale)) throw corrupt('locale', row.locale)
  if (!isSignupStatus(row.status)) throw corrupt('status', row.status)
  return {
    id: row.id,
    email: email.value,
    clientName: clientName.value,
    note: row.note,
    eventDate: row.event_date,
    locale: row.locale,
    status: row.status,
    createdAt: fromIsoText(row.created_at),
    confirmedAt: fromNullableIsoText(row.confirmed_at),
    claimedAt: fromNullableIsoText(row.claimed_at),
    decidedAt: fromNullableIsoText(row.decided_at),
    decidedBy: row.decided_by === null ? null : asUserId(row.decided_by),
    clientId: row.client_id === null ? null : asClientId(row.client_id),
    invitationTokenId:
      row.invitation_token_id === null ? null : asAccountTokenId(row.invitation_token_id),
  }
}

export class SqliteSignupRepository implements SignupRepository {
  constructor(private readonly db: Db) {}

  async issuedSince(since: Date): Promise<number> {
    return (
      this.db
        .prepare<[string], { n: number }>(
          `SELECT COUNT(*) AS n FROM account_tokens
            WHERE purpose = 'emailVerification' AND user_id IS NULL AND created_at > ?`,
        )
        .get(toIsoText(since))?.n ?? 0
    )
  }

  async admit(input: SignupAdmitInput): Promise<SignupAdmitResult> {
    const { request, token, now, maxPerDay } = input
    const since = toIsoText(new Date(now.getTime() - DAY_MS))
    const at = toIsoText(now)

    return this.db
      .transaction((): SignupAdmitResult => {
        const issuedToday =
          this.db
            .prepare<[string], { n: number }>(
              `SELECT COUNT(*) AS n FROM account_tokens
                WHERE purpose = 'emailVerification' AND user_id IS NULL AND created_at > ?`,
            )
            .get(since)?.n ?? 0
        // The ceiling answers everyone alike, before anything about the address is looked at: an
        // answer that depended on the address would be an oracle.
        if (issuedToday >= maxPerDay) return { outcome: 'busy', issuedToday }

        const rows = this.db
          .prepare<[string], SignupRow>(`SELECT ${COLUMNS} FROM signup_requests WHERE email = ?`)
          .all(request.email.value)
        const tokens = this.db
          .prepare<[string, string], { created_at: string }>(
            `SELECT created_at FROM account_tokens
              WHERE purpose = 'emailVerification' AND user_id IS NULL
                AND email = ? AND created_at > ?`,
          )
          .all(request.email.value, since)
        const latest = this.db
          .prepare<[string], { created_at: string | null }>(
            `SELECT MAX(created_at) AS created_at FROM account_tokens
              WHERE purpose = 'emailVerification' AND user_id IS NULL AND email = ?`,
          )
          .get(request.email.value)?.created_at

        const requests: AddressRequestView[] = rows.map((row) => ({
          status: row.status as SignupStatus,
          decidedAt: fromNullableIsoText(row.decided_at),
          // A request whose token was swept has nothing newer to say than its own creation.
          lastConfirmationAt: fromIsoText(latest ?? row.created_at),
        }))

        const decision = decideSignupAdmission({
          now,
          requests,
          confirmationsInLastDay: tokens.length,
        })
        if (decision === 'silent') return { outcome: 'silent', issuedToday }

        // The older links stop working, whether this is a new request or a resend: an old link must not
        // confirm a request made after it. Only signup tokens (no account) are touched.
        this.db
          .prepare(
            `UPDATE account_tokens SET revoked_at = ?
              WHERE purpose = 'emailVerification' AND user_id IS NULL AND email = ?
                AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
          )
          .run(at, request.email.value, at)

        if (decision === 'create') {
          this.db
            .prepare(
              `INSERT INTO signup_requests (${COLUMNS})
                    VALUES (@id, @email, @client_name, @note, @event_date, @locale, @status,
                            @created_at, NULL, NULL, NULL, NULL, NULL, NULL)`,
            )
            .run({
              id: request.id,
              email: request.email.value,
              client_name: request.clientName.value,
              note: request.note,
              event_date: request.eventDate,
              locale: request.locale,
              status: 'unconfirmed',
              created_at: toIsoText(request.createdAt),
            })
        } else {
          // `resend`: the request takes what was typed last, and counts from now (a resend is a new
          // submission of the form: its 30 days, and the 60-day bound, run from it).
          this.db
            .prepare(
              `UPDATE signup_requests
                  SET client_name = @client_name, note = @note, event_date = @event_date,
                      locale = @locale, created_at = @created_at
                WHERE email = @email AND status = 'unconfirmed'`,
            )
            .run({
              created_at: at,
              email: request.email.value,
              client_name: request.clientName.value,
              note: request.note,
              event_date: request.eventDate,
              locale: request.locale,
            })
        }

        this.db
          .prepare(
            `INSERT INTO account_tokens (id, purpose, token_digest, email, user_id, delivery,
                                         requires_approval, created_by, created_at, expires_at)
                  VALUES (?, 'emailVerification', ?, ?, NULL, 'mail', 0, NULL, ?, ?)`,
          )
          .run(
            token.id,
            token.tokenDigest,
            request.email.value,
            toIsoText(token.createdAt),
            toIsoText(token.expiresAt),
          )
        return {
          outcome: decision === 'create' ? 'created' : 'resent',
          issuedToday: issuedToday + 1,
        }
      })
      .immediate()
  }

  async findById(id: string): Promise<SignupRequest | null> {
    const row = this.db
      .prepare<[string], SignupRow>(`SELECT ${COLUMNS} FROM signup_requests WHERE id = ?`)
      .get(id)
    return row === undefined ? null : toRequest(row)
  }

  async peekConfirmation(tokenDigest: string, now: Date): Promise<SignupConfirmationPeek | null> {
    const token = this.db
      .prepare<
        [string],
        { email: string; consumed_at: string | null; revoked_at: string | null; expires_at: string }
      >(
        `SELECT email, consumed_at, revoked_at, expires_at FROM account_tokens
          WHERE token_digest = ? AND purpose = 'emailVerification' AND user_id IS NULL`,
      )
      .get(tokenDigest)
    if (token === undefined) return null
    const email = EmailAddress.fromStored(token.email)
    if (!email.ok) throw corrupt('email', email.error.code)

    if (token.consumed_at !== null || token.revoked_at !== null) {
      return { state: 'spent', email: email.value }
    }
    if (token.expires_at <= toIsoText(now)) return { state: 'expired', email: email.value }
    const waiting = this.db
      .prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM signup_requests WHERE email = ? AND status = 'unconfirmed'`,
      )
      .get(token.email)?.n
    // A live token whose request is gone (swept) opens nothing: it reads as spent.
    return { state: waiting === 0 ? 'spent' : 'usable', email: email.value }
  }

  async confirm(input: SignupConfirmInput): Promise<SignupConfirmResult> {
    const at = toIsoText(input.now)
    return this.db
      .transaction((): SignupConfirmResult => {
        const token = this.db
          .prepare<[string, string], { id: string; email: string }>(
            `SELECT id, email FROM account_tokens
              WHERE token_digest = ? AND purpose = 'emailVerification' AND user_id IS NULL
                AND ${ACCOUNT_TOKEN_USABLE_SQL}`,
          )
          .get(input.tokenDigest, at)
        if (token === undefined) return { kind: 'invalid' }

        const row = this.db
          .prepare<[string], SignupRow>(
            `SELECT ${COLUMNS} FROM signup_requests WHERE email = ? AND status = 'unconfirmed'`,
          )
          .get(token.email)
        if (row === undefined) return { kind: 'invalid' }

        const moved = confirmSignupRequest(toRequest(row), input.now, input.outcome)
        if (!moved.ok) return { kind: 'invalid' }

        // The token is spent only here, with the request moved: the two cannot part. It was read as
        // usable a moment ago in this same immediate transaction, so both UPDATEs match their row;
        // if either ever threw, the transaction would roll the other back.
        this.db
          .prepare<[string, string, string]>(
            `UPDATE account_tokens SET consumed_at = ?
              WHERE id = ? AND user_id IS NULL AND ${ACCOUNT_TOKEN_USABLE_SQL}`,
          )
          .run(at, token.id, at)
        this.db
          .prepare<[string, string, string | null, string]>(
            `UPDATE signup_requests SET status = ?, confirmed_at = ?, claimed_at = ?
              WHERE id = ? AND status = 'unconfirmed'`,
          )
          .run(input.outcome, at, input.outcome === 'approving' ? at : null, row.id)
        return { kind: 'confirmed', request: moved.value }
      })
      .immediate()
  }

  async claim(id: string, now: Date): Promise<boolean> {
    return (
      this.db
        .prepare<[string, string, string]>(
          `UPDATE signup_requests SET status = 'approving', claimed_at = ?
            WHERE id = ? AND status = 'pending' AND created_at > ?`,
        )
        .run(toIsoText(now), id, pendingCutoff(now)).changes === 1
    )
  }

  async release(id: string, claimedAt: Date): Promise<boolean> {
    return (
      this.db
        .prepare<[string, string]>(
          `UPDATE signup_requests SET status = 'pending', claimed_at = NULL
            WHERE id = ? AND status = 'approving' AND claimed_at = ?`,
        )
        .run(id, toIsoText(claimedAt)).changes === 1
    )
  }

  async finalize(id: string, finalization: SignupFinalization): Promise<boolean> {
    return (
      this.db
        .prepare(
          `UPDATE signup_requests
              SET status = 'approved', claimed_at = NULL, decided_at = @decided_at, decided_by = @decided_by,
                  client_id = @client_id, invitation_token_id = @invitation_token_id
            WHERE id = @id AND status = 'approving' AND claimed_at = @claimed_at`,
        )
        .run({
          id,
          claimed_at: toIsoText(finalization.claimedAt),
          decided_at: toIsoText(finalization.now),
          decided_by: finalization.decidedBy,
          client_id: finalization.clientId,
          invitation_token_id: finalization.invitationTokenId,
        }).changes === 1
    )
  }

  async refuse(id: string, by: UserId, now: Date): Promise<boolean> {
    return (
      this.db
        .prepare<[string, string, string, string]>(
          `UPDATE signup_requests SET status = 'refused', decided_at = ?, decided_by = ?
            WHERE id = ? AND status = 'pending' AND created_at > ?`,
        )
        .run(toIsoText(now), by, id, pendingCutoff(now)).changes === 1
    )
  }

  async listForOperator(filter: SignupListFilter): Promise<readonly SignupRequest[]> {
    if (!Number.isSafeInteger(filter.limit) || filter.limit < 1) {
      throw new RangeError('limit must be a positive integer')
    }
    if (filter.status === 'unconfirmed') return []
    const since = filter.since === undefined ? null : toIsoText(filter.since)
    const beforeAt = filter.before === undefined ? null : toIsoText(filter.before.at)
    const beforeId = filter.before?.id ?? null
    return this.db
      .prepare<(string | number | null)[], SignupRow>(
        `SELECT ${COLUMNS} FROM signup_requests
          WHERE status = ?
            AND (status <> 'pending' OR created_at > ?)
            AND (? IS NULL OR COALESCE(decided_at, confirmed_at, created_at) >= ?)
            AND (? IS NULL OR COALESCE(confirmed_at, created_at) < ?
                 OR (COALESCE(confirmed_at, created_at) = ? AND id < ?))
          ORDER BY COALESCE(confirmed_at, created_at) DESC, id DESC
          LIMIT ?`,
      )
      .all(
        filter.status,
        pendingCutoff(filter.now),
        since,
        since,
        beforeAt,
        beforeAt,
        beforeAt,
        beforeId,
        filter.limit,
      )
      .map(toRequest)
  }

  async countPending(now: Date): Promise<number> {
    return (
      this.db
        .prepare<[string], { n: number }>(
          `SELECT COUNT(*) AS n FROM signup_requests WHERE status = 'pending' AND created_at > ?`,
        )
        .get(pendingCutoff(now))?.n ?? 0
    )
  }

  async sweep(now: Date): Promise<SignupSweepResult> {
    return this.db
      .transaction((): SignupSweepResult => {
        const rows = this.db
          .prepare<[], SignupRow & { accepted: number; last_link_expires_at: string | null }>(
            `SELECT ${QUALIFIED_COLUMNS},
                    COALESCE(t.consumed_at IS NOT NULL, 0) AS accepted,
                    (SELECT MAX(c.expires_at) FROM account_tokens c
                      WHERE c.purpose = 'emailVerification' AND c.user_id IS NULL
                        AND c.email = s.email) AS last_link_expires_at
               FROM signup_requests s
               LEFT JOIN account_tokens t ON t.id = s.invitation_token_id`,
          )
          .all()
        const expiredIds: string[] = []
        const releasedIds: string[] = []
        const erase: string[] = []
        for (const row of rows) {
          const action = signupSweepAction(
            {
              status: row.status as SignupStatus,
              createdAt: fromIsoText(row.created_at),
              claimedAt: fromNullableIsoText(row.claimed_at),
              decidedAt: fromNullableIsoText(row.decided_at),
              lastConfirmationExpiresAt: fromNullableIsoText(row.last_link_expires_at),
              invitationAccepted: row.accepted === 1,
            },
            now,
          )
          if (action === 'keep') continue
          if (action === 'release') {
            releasedIds.push(row.id)
            continue
          }
          if (action === 'expire') expiredIds.push(row.id)
          erase.push(row.id)
        }
        const remove = this.db.prepare<[string]>(`DELETE FROM signup_requests WHERE id = ?`)
        for (const id of erase) remove.run(id)
        const release = this.db.prepare<[string]>(
          `UPDATE signup_requests SET status = 'pending', claimed_at = NULL
            WHERE id = ? AND status = 'approving'`,
        )
        for (const id of releasedIds) release.run(id)
        return { expiredIds, releasedIds, erased: erase.length }
      })
      .immediate()
  }
}
