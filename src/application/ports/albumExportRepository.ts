import type { AlbumExport, ExportFinish, ExportVerdict } from '../../domain/exports/albumExport'
import type { ExportStaleReason } from '../../domain/exports/albumExportStatus'
import type { EventId } from '../../domain/shared/ids'

/**
 * The one verified archive of each event (spec 22), and the count of requests behind the daily
 * ceiling.
 *
 * Every method is scoped by `eventId` except the box-wide reads the worker and the sweep need
 * (`claimNext`, `recoverRunning`, `listExpired`, `listSealedEventIds`, `listActiveEventIds`,
 * `sealedBytes`), which return ids and counts, never content.
 *
 * The moves that must be atomic (`claimNext`, `invalidate`, `finish`, `markServed`) are the
 * repository's job; **what they decide is the domain's** (`startExport`, `invalidateExport`,
 * `settleExport`, `serveExport`), so the SQLite adapter and the fake answer the same way and the
 * contract suite holds them to it.
 */
export interface AlbumExportRepository {
  find(eventId: EventId): Promise<AlbumExport | null>

  /**
   * A fresh request: replaces the event's row with this `queued` archive **and records the request**
   * (what the daily ceiling counts), in one step.
   */
  request(archive: AlbumExport): Promise<void>

  /** The oldest `queued` archive, **without** claiming it: what the worker looks at before it decides to wait. */
  findNextQueued(): Promise<AlbumExport | null>

  /**
   * The oldest `queued` archive, now `running` with `startedAt = now`; `null` when none is waiting.
   * Atomic: two callers never get the same one.
   */
  claimNext(now: Date): Promise<AlbumExport | null>

  /**
   * The final write of a build, atomic: the row **as it is now** must still be `running` (the domain
   * decides, `settleExport`), and only then it takes the verdict. A fact stamped while the file was
   * written is in that row, and a row the host re-requested or that was deleted meanwhile has no
   * verdict to receive (`superseded`).
   */
  finish(eventId: EventId, verdict: ExportVerdict, now: Date): Promise<ExportFinish>

  /**
   * A fact voids the archive (`invalidateExport`). Returns the archive as it is now, or `null` when
   * the event has none. Idempotent.
   */
  invalidate(eventId: EventId, reason: ExportStaleReason, now: Date): Promise<AlbumExport | null>

  /**
   * The whole file reached the host's socket on a `200`: stamps `served_at` and moves the expiry
   * (`serveExport`). Only a **sealed** row takes it; answers whether it did.
   */
  markServed(eventId: EventId, at: Date, expiresAt: Date): Promise<boolean>

  /** After a crash: every `running` archive goes back to `queued`. Answers how many. */
  recoverRunning(): Promise<number>

  /** Requests made for this event at or after `since`, a deleted archive's included. */
  countRequestsSince(eventId: EventId, since: Date): Promise<number>

  /** The earliest request of this event at or after `since`, or `null`: when a slot frees up. */
  firstRequestSince(eventId: EventId, since: Date): Promise<Date | null>

  /** Events whose sealed archive has an expiry at or before `now`. */
  listExpired(now: Date): Promise<readonly EventId[]>

  /** Events with a `sealed` archive: the ones whose file is expected on the disk. */
  listSealedEventIds(): Promise<readonly EventId[]>

  /** Events with a queued or running archive: their file, if any, must not be swept. */
  listActiveEventIds(): Promise<readonly EventId[]>

  /** Bytes held by sealed archives, box-wide, plus nothing for the ones in the making. */
  sealedBytes(): Promise<number>

  /** Removes the event's archive row. The request counter stays. Idempotent. */
  delete(eventId: EventId): Promise<void>
}
