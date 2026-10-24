import session from 'express-session'
import type { Express } from 'express'
import type { OperatorResetLinks } from '../../../domain/clients/operatorGuard'
import type { NewClientDefaults } from '../../../domain/clients/newClientCeilings'
import { asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { User } from '../../../domain/users/user'
import { makeAcceptInvitation } from '../../../application/usecases/auth/acceptInvitation'
import { makeIssueInvitation } from '../../../application/usecases/auth/issueInvitation'
import { makeIssuePasswordResetForAccount } from '../../../application/usecases/auth/issuePasswordResetForAccount'
import { makePreviewInvitation } from '../../../application/usecases/auth/previewInvitation'
import { makeApproveInvitation } from '../../../application/usecases/clients/approveInvitation'
import { makeApprovePasswordReset } from '../../../application/usecases/clients/approvePasswordReset'
import { makeCreateClient } from '../../../application/usecases/clients/createClient'
import { makeGetClientLimits } from '../../../application/usecases/clients/getClientLimits'
import { makeListClientAudit } from '../../../application/usecases/clients/listClientAudit'
import { makeListPendingInvitations } from '../../../application/usecases/clients/listPendingInvitations'
import { makeInviteToClientAsOperator } from '../../../application/usecases/clients/inviteToClientAsOperator'
import { makeProvisionClientOwner } from '../../../application/usecases/clients/provisionClientOwner'
import { makeRenameClient } from '../../../application/usecases/clients/renameClient'
import { makeResumeClient } from '../../../application/usecases/clients/resumeClient'
import { makeDisableAccount } from '../../../application/usecases/auth/disableAccount'
import { makeEnableAccount } from '../../../application/usecases/auth/enableAccount'
import { makeOffboardClient } from '../../../application/usecases/clients/offboardClient'
import { makeDeleteAccount } from '../../../application/usecases/site/deleteAccount'
import { SqliteAccountHoldings } from '../../../infrastructure/db/sqliteAccountHoldings'
import { makeSetClientCeilings } from '../../../application/usecases/clients/setClientCeilings'
import { makeSuspendClient } from '../../../application/usecases/clients/suspendClient'
import { makeListSiteAccounts } from '../../../application/usecases/site/listSiteAccounts'
import { makeListSiteAudit } from '../../../application/usecases/site/listSiteAudit'
import { makeListSiteClientEvents } from '../../../application/usecases/site/listSiteClientEvents'
import { makeListSiteClients } from '../../../application/usecases/site/listSiteClients'
import type { Logger } from '../../../application/ports/logger'
import type { Mailer } from '../../../application/ports/mailer'
import { AT } from '../../../application/testing/builders'
import { FakeClock } from '../../../application/testing/fakeClock'
import { FakeMailer } from '../../../application/testing/fakeMailer'
import { FakePasswordHasher } from '../../../application/testing/fakePasswordHasher'
import type { SiteWorld } from '../../../application/testing/fakeSiteOverview'
import { createSequentialIdGenerator } from '../../../infrastructure/crypto/sequentialIdGenerator'
import { sha256SecretTokens } from '../../../infrastructure/crypto/sha256SecretTokens'
import type { Db } from '../../../infrastructure/db/connection'
import { SqliteAccountTokenRepository } from '../../../infrastructure/db/sqliteAccountTokenRepository'
import { SqliteAuditLog } from '../../../infrastructure/db/sqliteAuditLog'
import { SqliteClientRepository } from '../../../infrastructure/db/sqliteClientRepository'
import { SqliteEventRepository } from '../../../infrastructure/db/sqliteEventRepository'
import { SqliteInvitationAcceptance } from '../../../infrastructure/db/sqliteInvitationAcceptance'
import { SqliteMembershipRepository } from '../../../infrastructure/db/sqliteMembershipRepository'
import { SqlitePhotoRepository } from '../../../infrastructure/db/sqlitePhotoRepository'
import { SqliteSecondFactorRepository } from '../../../infrastructure/db/sqliteSecondFactorRepository'
import { SqliteSiteOverview } from '../../../infrastructure/db/sqliteSiteOverview'
import { SqliteUserRepository } from '../../../infrastructure/db/sqliteUserRepository'
import {
  migratedDb,
  revealDatabase,
  sqliteWorld,
} from '../../../infrastructure/db/testing/sqliteSiteWorld'
import { silentLogger } from '../../../infrastructure/logging/pinoLogger'
import { nullMailer } from '../../../infrastructure/mail/nullMailer'
import type { HttpConfig } from '../types'
import { buildServerHarness } from './serverHarness'
import { signedInAs, signInByAddress, type Caller } from './signIn'

/**
 * The operator's namespace over the wire, **with real storage under it** (`/api/site`, G2-14).
 *
 * The whole server is `buildServer()`, and the use cases the operator's routes call are the real
 * ones, built the way `src/main/usecases.ts` builds them, over the real SQLite adapters on an
 * in-memory database. The only doubles are the clock, the mailer (a recorder, or the production
 * `nullMailer` when the box has no relay), the password hasher and the sign-in itself, which is
 * the one stand-in that matters: the account behind an address is chosen by the test, so a case
 * says **who** is asking without driving a login.
 *
 * Why SQLite and not the in-memory fakes the other HTTP suites use. What this suite is about is
 * what an operator **sees** after a route has changed something, and the operator's read model
 * (`SiteOverview`) is a set of joins over six tables. A fake that kept its own copy of the world
 * could pass while the real read model said something else, and the content sweep is only worth
 * running against the statements that will run in production. Storage is cheap here (a
 * `:memory:` database per test, migrated in milliseconds), and `siteOverviewContract` already
 * holds the fake and the adapter to one behaviour.
 *
 * **Sessions are stamped, not earned.** Passing a second factor and confirming a step-up are
 * the subject of `secondFactorRoutes.test.ts`, which drives the real use cases. Here they are
 * facts about a session (`secondFactorAt`, `stepUpAt`), written into the server-side store the
 * way the real routes write them, so that a case can say "an operator who has not passed the
 * factor" or "whose step-up lapsed a minute ago" in one line.
 */

export const PUBLIC_URL = 'http://localhost:4300'
export const OPERATOR_ADDRESS = 'operateur@example.test'
export const OPERATOR_ID = '11111111-1111-4111-8111-111111111111'

export interface SiteHarnessOptions {
  /** Whether the box can mail. Default `delivers`; `none` is the production `nullMailer`. */
  readonly mail?: 'delivers' | 'none'
  /** `OPERATOR_RESET_LINKS`. Default `mailOnly`, the default of every box. */
  readonly resetLinks?: OperatorResetLinks
  /** `REQUIRE_OPERATOR_2FA`. Default off, like a self-hosted box. */
  readonly secondFactorRequired?: boolean
  /** `SITE_ADMIN`. Default on: this suite is about the namespace being there. */
  readonly siteAdmin?: boolean
  /** `NEW_CLIENT_*`. Default none, like a box that set none. */
  readonly newClientDefaults?: NewClientDefaults
  /** Anything else `HttpConfig` carries. */
  readonly config?: Partial<HttpConfig>
  /** What the server and the use cases log to. Silent unless a case is about what a box writes. */
  readonly logger?: Logger
}

/** What a session may be stamped with: the two facts `requireSecondFactor` and `requireStepUp` read. */
export interface SessionStamps {
  readonly secondFactorAt?: number
  readonly stepUpAt?: number
}

const NO_DEFAULTS: NewClientDefaults = {
  maxEvents: null,
  maxEventsPerPeriod: null,
  maxTotalBytes: null,
  maxEventQuotaBytes: null,
  maxRetentionDays: null,
  maxLiveDays: null,
  clipsAllowed: true,
}

export interface SiteHarness {
  readonly app: Express
  readonly db: Db
  /** Plant clients, events, photographs, guests and the rest, through the real repositories. */
  readonly world: SiteWorld
  readonly clock: FakeClock
  /** The recorder behind a box that mails; `null` on a box with no relay. */
  readonly mailer: FakeMailer | null
  /** Every row of every table, as one string: what a sweep proves its plants were written to. */
  readonly reveal: () => string
  readonly sessions: session.MemoryStore
  /**
   * The repositories the server reads, for a case that arranges or inspects state the routes do
   * not offer (an event owner's membership, a client's stored suspension, a token's state).
   */
  readonly repos: {
    readonly clients: SqliteClientRepository
    readonly events: SqliteEventRepository
    readonly memberships: SqliteMembershipRepository
    readonly tokens: SqliteAccountTokenRepository
    readonly users: SqliteUserRepository
    readonly audit: SqliteAuditLog
  }
  /** Seeds an account and makes it one the stub sign-in knows by its address. */
  addAccount(user: User): Promise<void>
  /**
   * Makes an account the server created itself (by accepting an invitation) one the stub
   * sign-in knows by its address. `false` when there is no such account.
   */
  recognise(address: string): Promise<boolean>
  /** Signed in as the account behind this address, and nothing stamped on the session. */
  signIn(address: string): Promise<Caller>
  /** Writes the second-factor and step-up facts into every session this account has. */
  stamp(userId: string, stamps: SessionStamps): Promise<void>
  /**
   * The operator, signed in and **fully entitled**: the second factor passed where the box asks
   * for one, and a step-up confirmed this very instant.
   */
  signInAsOperator(): Promise<Caller>
}

export const buildSiteHarness = (options: SiteHarnessOptions = {}): SiteHarness => {
  const db = migratedDb()
  const world = sqliteWorld(db)
  const clock = new FakeClock(AT)

  const users = new SqliteUserRepository(db)
  const clients = new SqliteClientRepository(db)
  const events = new SqliteEventRepository(db)
  const memberships = new SqliteMembershipRepository(db)
  const photos = new SqlitePhotoRepository(db)
  const tokens = new SqliteAccountTokenRepository(db)
  const audit = new SqliteAuditLog(db)
  const overview = new SqliteSiteOverview(db)
  const secondFactors = new SqliteSecondFactorRepository(db)
  const acceptance = new SqliteInvitationAcceptance(db)
  const ids = createSequentialIdGenerator()
  const secrets = sha256SecretTokens
  const hasher = new FakePasswordHasher()
  const logger = options.logger ?? silentLogger()

  const recorder = options.mail === 'none' ? null : new FakeMailer()
  const mailer: Mailer = recorder ?? nullMailer

  const issueInvitation = makeIssueInvitation({
    tokens,
    secrets,
    mailer,
    ids,
    clock,
    logger,
    publicUrl: PUBLIC_URL,
  })
  const readers = { tokens, secrets, events, clients, memberships, users }

  const accounts: Record<string, string> = {}
  const sessions = new session.MemoryStore()
  const secondFactorRequired = options.secondFactorRequired ?? false

  const harness = buildServerHarness({
    sessionStore: sessions,
    logger,
    clock,
    config: {
      siteAdmin: options.siteAdmin ?? true,
      secondFactor: { available: secondFactorRequired, requiredForOperators: secondFactorRequired },
      ...options.config,
    },
    deps: { events, memberships, users, secondFactors, mailer },
    usecases: {
      authenticateUser: signInByAddress(accounts),

      listSiteClients: makeListSiteClients({ overview }),
      listSiteClientEvents: makeListSiteClientEvents({ overview }),
      listSiteAccounts: makeListSiteAccounts({ overview }),
      listSiteAudit: makeListSiteAudit({ audit }),

      provisionClientOwner: makeProvisionClientOwner({
        createClient: makeCreateClient({ clients, ids, clock }),
        issueInvitation,
        clients,
        tokens,
        newClientDefaults: options.newClientDefaults ?? NO_DEFAULTS,
        audit,
        clock,
      }),
      renameClient: makeRenameClient({ clients, audit, clock }),
      setClientCeilings: makeSetClientCeilings({ clients, audit, clock }),
      suspendClient: makeSuspendClient({ clients, audit, clock }),
      resumeClient: makeResumeClient({ clients, audit, clock }),
      offboardClient: makeOffboardClient({ clients, events, audit, clock }),
      disableAccount: makeDisableAccount({ users, clients, audit, clock }),
      enableAccount: makeEnableAccount({ users, clients, audit, clock }),
      deleteAccount: makeDeleteAccount({
        users,
        clients,
        holdings: new SqliteAccountHoldings(db),
        audit,
        clock,
      }),
      inviteToClientAsOperator: makeInviteToClientAsOperator({
        users,
        clients,
        tokens,
        issueInvitation,
        audit,
        clock,
      }),
      issuePasswordResetForAccount: makeIssuePasswordResetForAccount({
        users,
        clients,
        tokens,
        secrets,
        mailer,
        ids,
        clock,
        logger,
        publicUrl: PUBLIC_URL,
        mode: options.resetLinks ?? 'mailOnly',
        audit,
      }),
      approveInvitation: makeApproveInvitation({ users, clients, tokens, audit, clock }),
      // What the client's own space reads (G2-16), so a case can say what the owner sees of an act.
      getClientLimits: makeGetClientLimits({ clients, photos }),
      listClientAudit: makeListClientAudit({ clients, audit }),
      listPendingInvitations: makeListPendingInvitations({ clients, tokens, clock }),
      approvePasswordReset: makeApprovePasswordReset({ users, clients, tokens, audit, clock }),

      previewInvitation: makePreviewInvitation({ ...readers, clock }),
      acceptInvitation: makeAcceptInvitation({
        ...readers,
        hasher,
        acceptance,
        ids,
        clock,
      }),
    },
  })

  const addAccount = async (user: User): Promise<void> => {
    await world.addAccount(user)
    accounts[user.email.value] = user.id
  }

  const recognise = async (address: string): Promise<boolean> => {
    const parsed = EmailAddress.create(address)
    if (!parsed.ok) return false
    const found = await users.findByEmail(parsed.value)
    if (found === null) return false
    accounts[found.email.value] = found.id
    return true
  }

  const stamp = (userId: string, stamps: SessionStamps): Promise<void> =>
    new Promise((resolve, reject) => {
      sessions.all((error: unknown, all?: unknown) => {
        if (error !== null && error !== undefined) {
          reject(error instanceof Error ? error : new Error('the session store failed'))
          return
        }
        const entries =
          typeof all === 'object' && all !== null
            ? Object.entries(all as Record<string, Record<string, unknown>>)
            : []
        const mine = entries.filter(([, payload]) => payload['userId'] === asUserId(userId))
        let pending = mine.length
        if (pending === 0) {
          resolve()
          return
        }
        for (const [sid, payload] of mine) {
          sessions.set(
            sid,
            { ...payload, ...stamps } as session.SessionData,
            (failure: unknown) => {
              if (failure !== null && failure !== undefined) {
                reject(failure instanceof Error ? failure : new Error('the session store failed'))
                return
              }
              pending -= 1
              if (pending === 0) resolve()
            },
          )
        }
      })
    })

  const signInAsOperator = async (): Promise<Caller> => {
    const caller = await signedInAs(harness.app, OPERATOR_ADDRESS)
    const now = clock.now().getTime()
    await stamp(OPERATOR_ID, {
      stepUpAt: now,
      ...(secondFactorRequired ? { secondFactorAt: now } : {}),
    })
    return caller
  }

  return {
    app: harness.app,
    db,
    world,
    clock,
    mailer: recorder,
    reveal: () => revealDatabase(db),
    sessions,
    repos: { clients, events, memberships, tokens, users, audit },
    addAccount,
    recognise,
    signIn: (address) => signedInAs(harness.app, address),
    stamp,
    signInAsOperator,
  }
}
