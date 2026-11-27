import type { AccountToken } from '../../domain/users/accountToken'
import type { ClientId, UserId } from '../../domain/shared/ids'
import {
  decideSignupAdmission,
  type AddressRequestView,
} from '../../domain/signups/signupAdmission'
import {
  confirmSignupRequest,
  type SignupRequest,
  signupListedAt,
  signupPendingExpiresAt,
} from '../../domain/signups/signupRequest'
import { signupSweepAction } from '../../domain/signups/signupRetention'
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
} from '../ports/signupRepository'
import type { FakeAccountTokenRepository } from './fakeAccountTokenRepository'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * In-memory `SignupRepository`, behaving as the SQLite adapter does: every transition changes a request
 * **only if it is still in the state the transition leaves** (the second of two callers gets `false`),
 * `admit` and `confirm` write the request and its confirmation token together, and the foreign keys on
 * `decided_by` and `client_id` are mirrored by {@link FakeSignupRepository.withAccounts} and
 * {@link FakeSignupRepository.withClients} (a fake that accepted a client that does not exist would pass
 * tests the table fails).
 *
 * It shares the token store with the use case under test: pass the same `FakeAccountTokenRepository`
 * the rest of the scene uses, so a token written here is the one a token-side assertion sees.
 */
export class FakeSignupRepository implements SignupRepository {
  private readonly rows = new Map<string, SignupRequest>()
  private readonly accounts = new Set<UserId>()
  private readonly clients = new Set<ClientId>()

  constructor(private readonly tokens: FakeAccountTokenRepository) {}

  withAccounts(...ids: readonly UserId[]): this {
    for (const id of ids) this.accounts.add(id)
    return this
  }

  withClients(...ids: readonly ClientId[]): this {
    for (const id of ids) this.clients.add(id)
    return this
  }

  /** Every request held, in creation order. For a test to look at, not for a use case to read. */
  get all(): readonly SignupRequest[] {
    return [...this.rows.values()]
  }

  private confirmationTokens(email: string): AccountToken[] {
    return this.tokens.all.filter(
      (token) =>
        token.purpose === 'emailVerification' &&
        token.userId === null &&
        token.email.value === email,
    )
  }

  async admit(input: SignupAdmitInput): Promise<SignupAdmitResult> {
    const { request, token, now, maxPerDay } = input
    const since = now.getTime() - DAY_MS
    const issued = (list: readonly AccountToken[]): AccountToken[] =>
      list.filter((held) => held.createdAt.getTime() > since)

    const issuedToday = issued(
      this.tokens.all.filter(
        (held) => held.purpose === 'emailVerification' && held.userId === null,
      ),
    ).length
    if (issuedToday >= maxPerDay) return { outcome: 'busy', issuedToday }

    const mine = [...this.rows.values()].filter((row) => row.email.equals(request.email))
    const addressTokens = this.confirmationTokens(request.email.value)
    const latest = addressTokens.reduce<Date | null>(
      (best, held) => (best === null || held.createdAt > best ? held.createdAt : best),
      null,
    )
    const views: AddressRequestView[] = mine.map((row) => ({
      status: row.status,
      decidedAt: row.decidedAt,
      lastConfirmationAt: latest ?? row.createdAt,
    }))

    const decision = decideSignupAdmission({
      now,
      requests: views,
      confirmationsInLastDay: issued(addressTokens).length,
    })
    if (decision === 'silent') return { outcome: 'silent', issuedToday }

    if (decision === 'create' && this.rows.has(request.id)) {
      throw new Error('UNIQUE constraint failed: signup_requests.id')
    }
    // The token first: if it is refused (a digest already held), nothing else has changed, as the
    // transaction of the SQLite adapter would leave it.
    await this.tokens.save(token)
    // The older links stop working, for a new request as for a resend.
    await this.tokens.revokeOutstandingWithoutAccount(
      request.email,
      'emailVerification',
      now,
      token.id,
    )
    if (decision === 'create') {
      this.rows.set(request.id, request)
    } else {
      for (const row of mine) {
        if (row.status !== 'unconfirmed') continue
        // A resend is a new submission: what was typed last, counted from now.
        this.rows.set(row.id, {
          ...row,
          createdAt: now,
          clientName: request.clientName,
          note: request.note,
          eventDate: request.eventDate,
          locale: request.locale,
        })
      }
    }
    return { outcome: decision === 'create' ? 'created' : 'resent', issuedToday: issuedToday + 1 }
  }

  async issuedSince(since: Date): Promise<number> {
    return this.tokens.all.filter(
      (held) =>
        held.purpose === 'emailVerification' &&
        held.userId === null &&
        held.createdAt.getTime() > since.getTime(),
    ).length
  }

  async findById(id: string): Promise<SignupRequest | null> {
    return this.rows.get(id) ?? null
  }

  async peekConfirmation(tokenDigest: string, now: Date): Promise<SignupConfirmationPeek | null> {
    const token = this.tokens.all.find(
      (held) =>
        held.purpose === 'emailVerification' &&
        held.userId === null &&
        held.tokenDigest === tokenDigest,
    )
    if (token === undefined) return null
    if (token.consumedAt !== null || token.revokedAt !== null) {
      return { state: 'spent', email: token.email }
    }
    if (token.expiresAt.getTime() <= now.getTime()) return { state: 'expired', email: token.email }
    const waiting = [...this.rows.values()].some(
      (row) => row.email.equals(token.email) && row.status === 'unconfirmed',
    )
    return { state: waiting ? 'usable' : 'spent', email: token.email }
  }

  async confirm(input: SignupConfirmInput): Promise<SignupConfirmResult> {
    const token = await this.tokens.findUsable(input.tokenDigest, 'emailVerification', input.now)
    if (token === null || token.userId !== null) return { kind: 'invalid' }
    const row = [...this.rows.values()].find(
      (held) => held.email.equals(token.email) && held.status === 'unconfirmed',
    )
    if (row === undefined) return { kind: 'invalid' }
    const moved = confirmSignupRequest(row, input.now, input.outcome)
    if (!moved.ok) return { kind: 'invalid' }
    if (!(await this.tokens.consume(token.id, input.now))) return { kind: 'invalid' }
    this.rows.set(row.id, moved.value)
    return { kind: 'confirmed', request: moved.value }
  }

  async claim(id: string, now: Date): Promise<boolean> {
    const row = this.rows.get(id)
    if (row === undefined || row.status !== 'pending') return false
    if (now.getTime() >= signupPendingExpiresAt(row).getTime()) return false
    this.rows.set(id, { ...row, status: 'approving', claimedAt: now })
    return true
  }

  async release(id: string, claimedAt: Date): Promise<boolean> {
    const row = this.rows.get(id)
    if (row === undefined || row.status !== 'approving') return false
    if (row.claimedAt?.getTime() !== claimedAt.getTime()) return false
    this.rows.set(id, { ...row, status: 'pending', claimedAt: null })
    return true
  }

  async finalize(id: string, finalization: SignupFinalization): Promise<boolean> {
    const row = this.rows.get(id)
    if (row === undefined || row.status !== 'approving') return false
    if (row.claimedAt?.getTime() !== finalization.claimedAt.getTime()) return false
    if (finalization.decidedBy !== null && !this.accounts.has(finalization.decidedBy)) {
      throw new Error('FOREIGN KEY constraint failed: signup_requests.decided_by')
    }
    if (!this.clients.has(finalization.clientId)) {
      throw new Error('FOREIGN KEY constraint failed: signup_requests.client_id')
    }
    if (
      finalization.invitationTokenId !== null &&
      (await this.tokens.findById(finalization.invitationTokenId)) === null
    ) {
      throw new Error('FOREIGN KEY constraint failed: signup_requests.invitation_token_id')
    }
    this.rows.set(id, {
      ...row,
      status: 'approved',
      claimedAt: null,
      decidedAt: finalization.now,
      decidedBy: finalization.decidedBy,
      clientId: finalization.clientId,
      invitationTokenId: finalization.invitationTokenId,
    })
    return true
  }

  async refuse(id: string, by: UserId, now: Date): Promise<boolean> {
    const row = this.rows.get(id)
    if (row === undefined || row.status !== 'pending') return false
    if (now.getTime() >= signupPendingExpiresAt(row).getTime()) return false
    if (!this.accounts.has(by)) {
      throw new Error('FOREIGN KEY constraint failed: signup_requests.decided_by')
    }
    this.rows.set(id, { ...row, status: 'refused', decidedAt: now, decidedBy: by })
    return true
  }

  async listForOperator(filter: SignupListFilter): Promise<readonly SignupRequest[]> {
    if (!Number.isSafeInteger(filter.limit) || filter.limit < 1) {
      throw new RangeError('limit must be a positive integer')
    }
    if (filter.status === 'unconfirmed') return []
    const since = filter.since?.getTime() ?? null
    const before = filter.before
    const newestFirst = (left: SignupRequest, right: SignupRequest): number =>
      signupListedAt(right).getTime() - signupListedAt(left).getTime() ||
      (left.id < right.id ? 1 : left.id > right.id ? -1 : 0)
    return [...this.rows.values()]
      .filter((row) => row.status === filter.status)
      .filter(
        (row) =>
          since === null || (row.decidedAt ?? row.confirmedAt ?? row.createdAt).getTime() >= since,
      )
      .filter((row) => {
        if (before === undefined) return true
        const at = signupListedAt(row).getTime()
        return at < before.at.getTime() || (at === before.at.getTime() && row.id < before.id)
      })
      .sort(newestFirst)
      .slice(0, filter.limit)
  }

  async countPending(): Promise<number> {
    return [...this.rows.values()].filter((row) => row.status === 'pending').length
  }

  async sweep(now: Date): Promise<SignupSweepResult> {
    const expiredIds: string[] = []
    const releasedIds: string[] = []
    const erase: string[] = []
    for (const row of this.rows.values()) {
      const invitation =
        row.invitationTokenId === null ? null : await this.tokens.findById(row.invitationTokenId)
      const action = signupSweepAction(
        {
          status: row.status,
          createdAt: row.createdAt,
          claimedAt: row.claimedAt,
          decidedAt: row.decidedAt,
          lastConfirmationExpiresAt: this.confirmationTokens(row.email.value).reduce<Date | null>(
            (best, held) => (best === null || held.expiresAt > best ? held.expiresAt : best),
            null,
          ),
          invitationAccepted: invitation?.consumedAt != null,
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
    for (const id of erase) this.rows.delete(id)
    for (const id of releasedIds) {
      const row = this.rows.get(id)
      if (row !== undefined) this.rows.set(id, { ...row, status: 'pending', claimedAt: null })
    }
    return { expiredIds, releasedIds, erased: erase.length }
  }
}
