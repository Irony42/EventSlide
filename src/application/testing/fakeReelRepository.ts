import { storageRefusalFor } from '../../domain/events/admission'
import { isReelEligible } from '../../domain/highlights/highlightEligibility'
import type { ReelJob, ReelOutput } from '../../domain/highlights/reelJob'
import { isActive, canGoStale } from '../../domain/highlights/reelStatus'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { EventId, PhotoId } from '../../domain/shared/ids'
import type {
  ReelAdmission,
  ReelAdmissionLimits,
  ReelFinish,
  ReelFinishLimits,
  ReelInvalidation,
  ReelRepository,
} from '../ports/reelRepository'
import type { FakePhotoRepository } from './fakePhotoRepository'

/**
 * In-memory `ReelRepository`, behaving the way the SQLite adapter must (spec 08).
 *
 * One row per event, keyed by event id, as the unique index has it. It reads the photographs
 * through the fake photo repository it is given, because the final write's check ("every
 * photograph of the snapshot is still eligible") is a question about `photos`, which the adapter
 * asks in SQL. The fake photo repository is told to charge this one's bytes
 * (`chargeReelBytesFrom`), so the two arrive at the same quota sum the adapter's one statement
 * does.
 */
export class FakeReelRepository implements ReelRepository {
  private readonly rows = new Map<EventId, ReelJob>()

  constructor(private readonly photos: FakePhotoRepository) {
    photos.chargeReelBytesFrom(this)
  }

  /** Seed a row as the adapter would have restored it. */
  seed(...jobs: readonly ReelJob[]): this {
    for (const job of jobs) this.rows.set(job.eventId, job)
    return this
  }

  async findByEvent(eventId: EventId): Promise<ReelJob | null> {
    return this.rows.get(eventId) ?? null
  }

  async reelBytes(eventId: EventId): Promise<number> {
    return this.rows.get(eventId)?.output?.byteSize ?? 0
  }

  async request(job: ReelJob, limits: ReelAdmissionLimits): Promise<ReelAdmission> {
    const current = this.rows.get(job.eventId) ?? null
    if (current !== null && isActive(current.status)) {
      return { refusal: { reason: 'alreadyRunning' }, replacedOutput: null }
    }

    const depth = await this.countActive()
    if (depth >= limits.maxQueued) {
      return {
        refusal: { reason: 'queueFull', depth, maxDepth: limits.maxQueued },
        replacedOutput: null,
      }
    }

    const replaced = current?.output ?? null
    const released = replaced?.byteSize ?? 0
    const used = (await this.photos.totalBytes(job.eventId)) - released
    const clientBytes = limits.clientBytes
    const clientUsed =
      clientBytes === null
        ? 0
        : (await this.photos.clientTotalBytes(clientBytes.clientId)) - released

    const refusal = storageRefusalFor(
      limits.reservedBytes,
      { quotaBytes: limits.quotaBytes, usedBytes: used },
      clientBytes === null ? null : { maxBytes: clientBytes.maxBytes, usedBytes: clientUsed },
    )
    if (refusal !== null) return { refusal, replacedOutput: null }

    this.rows.set(job.eventId, job)
    return { refusal: null, replacedOutput: replaced?.hash ?? null }
  }

  async claimNext(now: Date): Promise<ReelJob | null> {
    const due = [...this.rows.values()]
      .filter((job) => job.status === 'queued' && job.notBefore.getTime() <= now.getTime())
      .sort(
        (left, right) =>
          left.notBefore.getTime() - right.notBefore.getTime() ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          (left.id < right.id ? -1 : 1),
      )[0]
    if (due === undefined) return null

    const claimed = due.claim(now)
    if (!claimed.ok) throw new Error(`a queued reel could not be claimed: ${claimed.error.code}`)
    this.rows.set(claimed.value.eventId, claimed.value)
    return claimed.value
  }

  async save(job: ReelJob): Promise<boolean> {
    const held = this.rows.get(job.eventId)
    if (held === undefined || held.id !== job.id) return false
    this.rows.set(job.eventId, job)
    return true
  }

  async finish(
    job: ReelJob,
    output: ReelOutput,
    limits: ReelFinishLimits,
    now: Date,
  ): Promise<ReelFinish> {
    const held = this.rows.get(job.eventId)
    if (held === undefined || held.id !== job.id) return { kind: 'gone' }
    if (held.status !== 'running') return { kind: 'stale' }

    for (const photoId of held.photoIds) {
      const photo = await this.photos.findById(job.eventId, photoId)
      if (photo === null || !isReelEligible(photo.status, photo.kind)) {
        const spoiled = held.makeStale(now)
        if (!spoiled.ok) throw new Error('a running reel could not be made stale')
        this.rows.set(job.eventId, spoiled.value)
        return { kind: 'stale' }
      }
    }

    const clientBytes = limits.clientBytes
    const refusal = storageRefusalFor(
      output.byteSize,
      { quotaBytes: limits.quotaBytes, usedBytes: await this.photos.totalBytes(job.eventId) },
      clientBytes === null
        ? null
        : {
            maxBytes: clientBytes.maxBytes,
            usedBytes: await this.photos.clientTotalBytes(clientBytes.clientId),
          },
    )
    if (refusal !== null) return { kind: 'refused', refusal }

    const done = held.succeed(output, now)
    if (!done.ok) throw new Error('a running reel could not be finished')
    this.rows.set(job.eventId, done.value)
    return { kind: 'done' }
  }

  async invalidate(
    eventId: EventId,
    photoIds: readonly PhotoId[],
    now: Date,
  ): Promise<ReelInvalidation> {
    const held = this.rows.get(eventId)
    if (held === undefined || !canGoStale(held.status)) return { staled: false, output: null }
    if (!photoIds.some((id) => held.includes(id))) return { staled: false, output: null }

    const spoiled = held.makeStale(now)
    if (!spoiled.ok) throw new Error('a live reel could not be made stale')
    this.rows.set(eventId, spoiled.value)
    return { staled: true, output: held.output?.hash ?? null }
  }

  async clearOutput(eventId: EventId, hash: ContentHash): Promise<void> {
    const held = this.rows.get(eventId)
    if (held === undefined || held.output === null || !held.output.hash.equals(hash)) return
    this.rows.set(eventId, held.withoutOutput(held.updatedAt))
  }

  async recoverAbandoned(now: Date): Promise<number> {
    let count = 0
    for (const job of this.rows.values()) {
      if (job.status !== 'running') continue
      const next = job.recover(now)
      if (!next.ok) throw new Error('a running reel could not be recovered')
      this.rows.set(job.eventId, next.value)
      count += 1
    }
    return count
  }

  async listStaleOutputs(): Promise<
    readonly { readonly eventId: EventId; readonly hash: ContentHash }[]
  > {
    return [...this.rows.values()].flatMap((job) =>
      job.status === 'stale' && job.output !== null
        ? [{ eventId: job.eventId, hash: job.output.hash }]
        : [],
    )
  }

  async listReferencedDigests(eventId: EventId): Promise<ReadonlySet<string>> {
    const output = this.rows.get(eventId)?.output
    return new Set(output === undefined || output === null ? [] : [output.hash.value])
  }

  async countActive(): Promise<number> {
    return [...this.rows.values()].filter((job) => isActive(job.status)).length
  }
}
