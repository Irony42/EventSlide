import { Store, type SessionData } from 'express-session'
import type { Db } from './connection'
import type { Clock } from '../../application/ports/clock'
import type { Logger } from '../../application/ports/logger'
import { setBackgroundInterval } from '../time/backgroundTimers'

/**
 * Host and moderator sessions in SQLite.
 *
 * 1.0 used `express-session`'s default `MemoryStore`, which the library itself warns is
 * not for production. Two consequences that actually bit: every session was lost on
 * restart, so a host who restarted the server mid-event was logged out with a room
 * full of guests uploading; and the store never evicts, so it leaks for as long as the
 * process lives.
 *
 * Same connection as everything else, so a host's session and their event's photos are
 * in the one file they can copy to a USB stick.
 */

export interface SqliteSessionStoreOptions {
  readonly db: Db
  readonly logger: Logger
  /**
   * Where "now" comes from: a session expires when this clock says so. The absolute
   * seven-day cap in `authz` is judged by an injected clock too. (`express-session` works out
   * a cookie's relative `maxAge` from the wall clock before it reaches `set`; that is a
   * duration, so any clock is consistent with it.)
   */
  readonly clock: Clock
  /** How often expired rows are swept. */
  readonly sweepIntervalMs?: number
}

const DEFAULT_SWEEP_INTERVAL_MS = 15 * 60 * 1000

/** Fallback when a session carries no `maxAge`, matching the cookie default. */
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000

interface SessionRow {
  readonly data: string
}

export class SqliteSessionStore extends Store {
  private readonly db: Db
  private readonly logger: Logger
  private readonly clock: Clock
  private readonly sweepTimer: NodeJS.Timeout

  constructor({
    db,
    logger,
    clock,
    sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
  }: SqliteSessionStoreOptions) {
    super()
    this.db = db
    this.logger = logger
    this.clock = clock

    // Sweep once at construction, so a restart after a long shutdown does not carry
    // a backlog of dead rows into the first request.
    this.sweep()
    // A background interval: a ref'd one keeps the process alive and `npm start` never exits
    // on Ctrl-C.
    this.sweepTimer = setBackgroundInterval(() => this.sweep(), sweepIntervalMs)
  }

  override get(
    sid: string,
    callback: (error?: unknown, session?: SessionData | null) => void,
  ): void {
    try {
      const row = this.db
        .prepare<[string, number], SessionRow>(
          `SELECT data FROM sessions WHERE sid = ? AND expires_at > ?`,
        )
        .get(sid, this.nowMs())

      // An expired row is reported as absent rather than deleted here: `get` is on
      // every authenticated request, and the sweeper already owns removal.
      if (!row) {
        callback(undefined, null)
        return
      }
      callback(undefined, JSON.parse(row.data) as SessionData)
    } catch (error) {
      // A corrupt row must read as "no session", not as a 500 on every request from
      // the one client holding it.
      this.logger.warn('session row could not be read', {
        error: error instanceof Error ? error.message : String(error),
      })
      callback(undefined, null)
    }
  }

  override set(sid: string, session: SessionData, callback?: (error?: unknown) => void): void {
    try {
      this.db
        .prepare(
          `INSERT INTO sessions (sid, expires_at, data) VALUES (?, ?, ?)
             ON CONFLICT (sid) DO UPDATE SET expires_at = excluded.expires_at,
                                             data       = excluded.data`,
        )
        .run(sid, this.expiryOf(session), JSON.stringify(session))
      callback?.()
    } catch (error) {
      callback?.(error)
    }
  }

  override destroy(sid: string, callback?: (error?: unknown) => void): void {
    try {
      this.db.prepare(`DELETE FROM sessions WHERE sid = ?`).run(sid)
      callback?.()
    } catch (error) {
      callback?.(error)
    }
  }

  /**
   * Extends the expiry without rewriting the payload. `express-session` calls this on
   * every request when `rolling` is on, so it is the hottest write in the app.
   */
  override touch(sid: string, session: SessionData, callback?: () => void): void {
    try {
      this.db
        .prepare(`UPDATE sessions SET expires_at = ? WHERE sid = ?`)
        .run(this.expiryOf(session), sid)
    } catch (error) {
      this.logger.warn('session touch failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    callback?.()
  }

  override length(callback: (error: unknown, length?: number) => void): void {
    try {
      const row = this.db
        .prepare<[number], { count: number }>(
          `SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?`,
        )
        .get(this.nowMs())
      callback(null, row?.count ?? 0)
    } catch (error) {
      callback(error)
    }
  }

  override clear(callback?: (error?: unknown) => void): void {
    try {
      this.db.prepare(`DELETE FROM sessions`).run()
      callback?.()
    } catch (error) {
      callback?.(error)
    }
  }

  /** Removes expired rows. Returns the count, for the test and the log line. */
  sweep(): number {
    try {
      const result = this.db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(this.nowMs())
      if (result.changes > 0) {
        this.logger.debug('swept expired sessions', { removed: result.changes })
      }
      return result.changes
    } catch (error) {
      this.logger.warn('session sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return 0
    }
  }

  /** Stops the sweeper. Called from the graceful-shutdown path. */
  close(): void {
    clearInterval(this.sweepTimer)
  }

  private expiryOf(session: SessionData): number {
    // Any finite `maxAge` is authoritative, including zero or negative. An earlier
    // version guarded on `maxAge > 0`, which meant a cookie express-session had
    // already expired fell through to the default lifetime and was silently revived
    // for another twelve hours.
    const maxAge = session.cookie?.maxAge
    if (typeof maxAge === 'number' && Number.isFinite(maxAge)) return this.nowMs() + maxAge

    const expires = session.cookie?.expires
    if (expires instanceof Date && Number.isFinite(expires.getTime())) return expires.getTime()

    return this.nowMs() + DEFAULT_TTL_MS
  }

  private nowMs(): number {
    return this.clock.now().getTime()
  }
}
