import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import type { SignupRepository } from '../../ports/signupRepository'
import type { NotifySignupOperator } from './notifySignupOperator'

export interface SweepSignupsDeps {
  readonly signups: Pick<SignupRepository, 'sweep'>
  readonly audit: AuditRecorder
  readonly notify: NotifySignupOperator
  readonly clock: Clock
  readonly logger: Logger
}

export interface SweepSignupsReport {
  readonly expired: number
  readonly released: number
  readonly erased: number
}

export type SweepSignups = () => Promise<SweepSignupsReport>

/**
 * The signups' share of the retention sweep (spec 31 section 4.3): requests past their time are erased
 * (`SignupRepository.sweep`, which also gives back a claim older than an hour). Two things follow:
 *
 * - each request that **expired** (nobody decided in 30 days) leaves one line, `signup.expired`, under the
 *   subject `access_request` with the request's id and never its address;
 * - a **released** claim is a request that is waiting again, so the operator is told once for all of them, and
 *   whatever the notifier held back is flushed.
 *
 * A line the log refuses is logged and does not stop the others: the request is already erased.
 */
export const makeSweepSignups =
  ({ signups, audit, notify, clock, logger }: SweepSignupsDeps): SweepSignups =>
  async () => {
    const now = clock.now()
    const swept = await signups.sweep(now)

    for (const id of swept.expiredIds) {
      const entry = AuditEntry.create({
        at: now,
        actor: { kind: 'system', label: 'retention-sweeper' },
        action: 'signup.expired',
        subject: { type: 'access_request', id },
        clientId: null,
        details: {},
      })
      if (!entry.ok) {
        logger.error('a signup expiry could not be recorded', { code: entry.error.code })
        continue
      }
      try {
        await audit.record(entry.value)
      } catch (error) {
        logger.error('a signup expiry could not be recorded', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (swept.releasedIds.length > 0) await notify('waiting', swept.releasedIds.length)
    // What the throttle held back since the last hour (a count of either kind) goes out now if the hour allows,
    // so it does not wait for the next signup.
    await notify.flush()

    return {
      expired: swept.expiredIds.length,
      released: swept.releasedIds.length,
      erased: swept.erased,
    }
  }
