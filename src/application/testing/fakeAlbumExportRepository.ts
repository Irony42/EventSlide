import {
  finishOfExport,
  invalidateExport,
  serveExport,
  settleExport,
  startExport,
  type AlbumExport,
  type ExportFinish,
  type ExportVerdict,
} from '../../domain/exports/albumExport'
import {
  exportHasFile,
  isExportActive,
  type ExportStaleReason,
} from '../../domain/exports/albumExportStatus'
import type { EventId } from '../../domain/shared/ids'
import type { AlbumExportRepository } from '../ports/albumExportRepository'

/**
 * In-memory `AlbumExportRepository`. One row per event, a list of request instants, and the same
 * domain moves as the SQLite adapter, which the contract suite checks.
 */
export class FakeAlbumExportRepository implements AlbumExportRepository {
  private readonly exports = new Map<EventId, AlbumExport>()
  private readonly requests: { readonly eventId: EventId; readonly at: Date }[] = []

  async find(eventId: EventId): Promise<AlbumExport | null> {
    return this.exports.get(eventId) ?? null
  }

  async request(archive: AlbumExport): Promise<void> {
    this.exports.set(archive.eventId, archive)
    this.requests.push({ eventId: archive.eventId, at: archive.requestedAt })
  }

  async findNextQueued(): Promise<AlbumExport | null> {
    return (
      [...this.exports.values()]
        .filter((archive) => archive.status === 'queued')
        .sort((left, right) => left.requestedAt.getTime() - right.requestedAt.getTime())[0] ?? null
    )
  }

  async claimNext(now: Date): Promise<AlbumExport | null> {
    const next = await this.findNextQueued()
    if (next === null) return null
    const started = startExport(next, now)
    if (!started.ok) return null
    this.exports.set(next.eventId, started.value)
    return started.value
  }

  async finish(eventId: EventId, verdict: ExportVerdict, now: Date): Promise<ExportFinish> {
    const archive = this.exports.get(eventId)
    if (archive === undefined) return 'superseded'
    const settled = settleExport(archive, verdict, now)
    if (!settled.ok) return 'superseded'
    this.exports.set(eventId, settled.value)
    return finishOfExport(settled.value)
  }

  async invalidate(
    eventId: EventId,
    reason: ExportStaleReason,
    now: Date,
  ): Promise<AlbumExport | null> {
    const archive = this.exports.get(eventId)
    if (archive === undefined) return null
    const next = invalidateExport(archive, reason, now)
    this.exports.set(eventId, next)
    return next
  }

  async markServed(eventId: EventId, at: Date, expiresAt: Date): Promise<boolean> {
    const archive = this.exports.get(eventId)
    if (archive === undefined) return false
    const served = serveExport(archive, at, expiresAt)
    if (!served.ok) return false
    this.exports.set(eventId, served.value)
    return true
  }

  async recoverRunning(): Promise<number> {
    let recovered = 0
    for (const [eventId, archive] of this.exports) {
      if (archive.status !== 'running') continue
      this.exports.set(eventId, { ...archive, status: 'queued', startedAt: null })
      recovered += 1
    }
    return recovered
  }

  async countRequestsSince(eventId: EventId, since: Date): Promise<number> {
    return this.requests.filter(
      (request) => request.eventId === eventId && request.at.getTime() >= since.getTime(),
    ).length
  }

  async firstRequestSince(eventId: EventId, since: Date): Promise<Date | null> {
    const times = this.requests
      .filter((request) => request.eventId === eventId && request.at.getTime() >= since.getTime())
      .map((request) => request.at.getTime())
    return times.length === 0 ? null : new Date(Math.min(...times))
  }

  async listExpired(now: Date): Promise<readonly EventId[]> {
    return [...this.exports.values()]
      .filter(
        (archive) =>
          exportHasFile(archive.status) &&
          archive.expiresAt !== null &&
          archive.expiresAt.getTime() <= now.getTime(),
      )
      .map((archive) => archive.eventId)
  }

  async listSealedEventIds(): Promise<readonly EventId[]> {
    return [...this.exports.values()]
      .filter((archive) => exportHasFile(archive.status))
      .map((archive) => archive.eventId)
  }

  async listActiveEventIds(): Promise<readonly EventId[]> {
    return [...this.exports.values()]
      .filter((archive) => isExportActive(archive.status))
      .map((archive) => archive.eventId)
  }

  async sealedBytes(): Promise<number> {
    return [...this.exports.values()]
      .filter((archive) => exportHasFile(archive.status))
      .reduce((sum, archive) => sum + (archive.bytes ?? 0), 0)
  }

  async delete(eventId: EventId): Promise<void> {
    this.exports.delete(eventId)
  }
}
