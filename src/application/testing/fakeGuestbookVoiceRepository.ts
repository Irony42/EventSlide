import { storageRefusalFor } from '../../domain/events/admission'
import { GuestbookEntry } from '../../domain/guestbook/guestbookEntry'
import type { GuestbookVoice } from '../../domain/guestbook/guestbookVoice'
import { admitsAnotherVoice, voiceRefusalFor } from '../../domain/guestbook/guestbookVoiceLimits'
import {
  blocksVoiceResend,
  countsAgainstVoiceLimits,
  holdsVoiceBytes,
  holdsVoiceSource,
} from '../../domain/guestbook/guestbookVoiceState'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { EventId, GuestId, GuestbookEntryId } from '../../domain/shared/ids'
import type {
  GuestbookVoiceRepository,
  VoiceAdmission,
  VoiceAdmissionLimits,
  VoiceFinish,
  VoiceFinishLimits,
} from '../ports/guestbookVoiceRepository'
import type { ClientByteLimit } from '../ports/clientRepository'
import type { ClientEventSource } from './fakeClientRepository'
import type { PhotoByteSource } from './fakeClipJobRepository'
import type { FakeGuestbookRepository } from './fakeGuestbookRepository'
import { compareIds } from './ordering'

/**
 * The voice messages' queue and rows, in memory, over the guestbook's own rows.
 *
 * **A view, not a second store.** A voice message is an entry of the book, so this fake holds no
 * rows of its own: it reads and writes the `FakeGuestbookRepository` it is built over, as the two
 * SQLite adapters share one table. A decision here and a read there therefore always agree, which
 * is what makes a failed voice drop out of the guestbook's counts in a ring-2 test the way the
 * `LEFT JOIN` makes it in production.
 *
 * `admitVoice` decides with no `await` between its counts and its write, as the adapter's
 * transaction does (the photographs' half of the quota is fetched first and once, the rest read
 * synchronously after). Its quota counts the photographs and the voices: a test about a clip
 * queue wires the clips elsewhere, and the SQL (`eventBytesSum.test.ts`) is the proof of the sum
 * over every table.
 */

const rowsOf = (book: FakeGuestbookRepository, eventId: EventId): GuestbookEntry[] =>
  book.all(eventId).filter((row) => row.voice !== null)

const voiceOf = (entry: GuestbookEntry): GuestbookVoice => {
  const voice = entry.voice
  if (voice === null) throw new Error('a voice message was expected')
  return voice
}

const withVoice = (entry: GuestbookEntry, voice: GuestbookVoice): GuestbookEntry =>
  GuestbookEntry.restore({ ...entry.toProps(), voice })

export class FakeGuestbookVoiceRepository implements GuestbookVoiceRepository {
  constructor(private readonly book: FakeGuestbookRepository) {}

  /** The photographs of an event, which this fake cannot see on its own. Unwired: none. */
  private photos: PhotoByteSource | null = null

  chargePhotoBytesFrom(source: PhotoByteSource): this {
    this.photos = source
    return this
  }

  /** Which events belong to a client. A ceiling asked without it throws rather than pass. */
  private clientEvents: ClientEventSource | null = null

  chargeClientEventsFrom(source: ClientEventSource): this {
    this.clientEvents = source
    return this
  }

  /**
   * The events of a client and what their photographs hold, fetched before the synchronous part of
   * a decision (a client ceiling with no wired source throws rather than pass).
   */
  private async clientHoldings(
    clientBytes: ClientByteLimit | null,
  ): Promise<{ events: readonly EventId[]; photoBytes: number }> {
    if (clientBytes === null) return { events: [], photoBytes: 0 }
    if (this.clientEvents === null) {
      throw new Error(
        'FakeGuestbookVoiceRepository: a client byte ceiling needs chargeClientEventsFrom(clients), or it would be judged against a client with no events',
      )
    }
    const events = this.clientEvents.eventsOf(clientBytes.clientId)
    const perEvent = await Promise.all(
      events.map(async (id) => (await this.photos?.photoBytes(id)) ?? 0),
    )
    return { events, photoBytes: perEvent.reduce((total, bytes) => total + bytes, 0) }
  }

  private voiceBytesNow(eventId: EventId): number {
    return rowsOf(this.book, eventId).reduce((total, row) => {
      const voice = voiceOf(row)
      if (!holdsVoiceBytes(voice.state)) return total
      return total + (voice.state === 'ready' ? (voice.audioByteSize ?? 0) : voice.sourceByteSize)
    }, 0)
  }

  private inFlight(): GuestbookEntry[] {
    return this.book
      .everything()
      .filter((row) => row.voice !== null && holdsVoiceSource(voiceOf(row).state))
  }

  async admitVoice(entry: GuestbookEntry, limits: VoiceAdmissionLimits): Promise<VoiceAdmission> {
    const { eventId, guestId } = entry
    const voice = voiceOf(entry)

    const photoBytes = (await this.photos?.photoBytes(eventId)) ?? 0
    const clientBytes = limits.clientBytes ?? null
    const { events: clientEvents, photoBytes: clientPhotoBytes } =
      await this.clientHoldings(clientBytes)

    // From here on there is no `await`: the counts and the write are one step, as in the adapter.
    const duplicate = rowsOf(this.book, eventId).find((row) => {
      const held = voiceOf(row)
      return blocksVoiceResend(held.state) && held.sourceHash.equals(voice.sourceHash)
    })
    if (duplicate !== undefined) return { kind: 'duplicate', entry: duplicate }

    const live = this.book.all(eventId).filter((row) => {
      const held = row.voice
      return held === null || countsAgainstVoiceLimits(held.state)
    })
    const limit = voiceRefusalFor({
      heldByGuest: live.filter((row) => row.guestId === guestId).length,
      openInEvent: live.filter((row) => row.status !== 'rejected' && row.takenDownAt === null)
        .length,
      voicesInEvent: live.filter(
        (row) => row.voice !== null && row.status !== 'rejected' && row.takenDownAt === null,
      ).length,
    })
    if (limit !== null) return { kind: 'refused', refusal: { reason: 'limit', limit } }

    const eventDepth = this.inFlight().filter((row) => row.eventId === eventId).length
    const depth = this.inFlight().length
    if (!admitsAnotherVoice(eventDepth, limits.maxQueuedVoicesPerEvent)) {
      return {
        kind: 'refused',
        refusal: {
          reason: 'queueFull',
          depth: Math.max(eventDepth, depth),
          maxDepth: limits.maxQueuedVoicesPerEvent,
        },
      }
    }
    if (!admitsAnotherVoice(depth, limits.maxQueuedVoices)) {
      return {
        kind: 'refused',
        refusal: { reason: 'queueFull', depth, maxDepth: limits.maxQueuedVoices },
      }
    }

    const storage = storageRefusalFor(
      voice.sourceByteSize,
      { quotaBytes: limits.quotaBytes, usedBytes: photoBytes + this.voiceBytesNow(eventId) },
      clientBytes === null
        ? null
        : {
            maxBytes: clientBytes.maxBytes,
            usedBytes:
              clientPhotoBytes +
              clientEvents.reduce((total, id) => total + this.voiceBytesNow(id), 0),
          },
    )
    if (storage !== null) return { kind: 'refused', refusal: storage }

    this.book.put(entry)
    return { kind: 'added', entry }
  }

  async saveVoice(
    eventId: EventId,
    entryId: GuestbookEntryId,
    voice: GuestbookVoice,
  ): Promise<boolean> {
    const current = this.book.all(eventId).find((row) => row.id === entryId && row.voice !== null)
    if (current === undefined) return false
    this.book.put(withVoice(current, voice))
    return true
  }

  async markReady(
    eventId: EventId,
    entryId: GuestbookEntryId,
    voice: GuestbookVoice,
    limits: VoiceFinishLimits,
  ): Promise<VoiceFinish> {
    const output = voice.audioByteSize
    if (!voice.isReady() || output === null) {
      throw new Error('FakeGuestbookVoiceRepository.markReady takes a ready voice')
    }

    const photoBytes = (await this.photos?.photoBytes(eventId)) ?? 0
    const clientBytes = limits.clientBytes ?? null
    const { events: clientEvents, photoBytes: clientPhotoBytes } =
      await this.clientHoldings(clientBytes)

    // From here on there is no `await`: the sums and the write are one step, as in the adapter.
    const current = this.book.all(eventId).find((row) => row.id === entryId && row.voice !== null)
    if (current === undefined) return { kind: 'gone' }

    // The source this output replaces: charged while the voice ran, so left out of the figure the
    // output is judged against.
    const held = voiceOf(current)
    const credit = !holdsVoiceBytes(held.state)
      ? 0
      : held.state === 'ready'
        ? (held.audioByteSize ?? 0)
        : held.sourceByteSize

    const storage = storageRefusalFor(
      output,
      {
        quotaBytes: limits.quotaBytes,
        usedBytes: photoBytes + this.voiceBytesNow(eventId) - credit,
      },
      clientBytes === null
        ? null
        : {
            maxBytes: clientBytes.maxBytes,
            usedBytes:
              clientPhotoBytes +
              clientEvents.reduce((total, id) => total + this.voiceBytesNow(id), 0) -
              credit,
          },
    )
    if (storage !== null) return { kind: 'refused', refusal: storage }

    this.book.put(withVoice(current, voice))
    return { kind: 'saved' }
  }

  async findBySourceHash(
    eventId: EventId,
    sourceHash: ContentHash,
  ): Promise<GuestbookEntry | null> {
    return (
      rowsOf(this.book, eventId).find((row) => {
        const held = voiceOf(row)
        return (
          row.takenDownAt === null &&
          blocksVoiceResend(held.state) &&
          held.sourceHash.equals(sourceHash)
        )
      }) ?? null
    )
  }

  async findByEntry(eventId: EventId, entryId: GuestbookEntryId): Promise<GuestbookEntry | null> {
    return (
      rowsOf(this.book, eventId).find((row) => row.id === entryId && row.takenDownAt === null) ??
      null
    )
  }

  async listByGuest(eventId: EventId, guestId: GuestId): Promise<readonly GuestbookEntry[]> {
    return rowsOf(this.book, eventId)
      .filter((row) => row.guestId === guestId && row.takenDownAt === null)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
  }

  async countOpenByEvent(eventId: EventId): Promise<number> {
    return rowsOf(this.book, eventId).filter(
      (row) =>
        row.status !== 'rejected' &&
        row.takenDownAt === null &&
        countsAgainstVoiceLimits(voiceOf(row).state),
    ).length
  }

  async queuedCount(): Promise<number> {
    return this.inFlight().length
  }

  async deleteByEntry(eventId: EventId, entryId: GuestbookEntryId): Promise<void> {
    const current = rowsOf(this.book, eventId).find((row) => row.id === entryId)
    if (current !== undefined) this.book.remove(eventId, entryId)
  }

  async listReferencedDigests(
    eventId: EventId,
    excludingEntries: readonly GuestbookEntryId[] = [],
  ): Promise<ReadonlySet<string>> {
    const named = new Set<string>()
    for (const row of rowsOf(this.book, eventId)) {
      if (excludingEntries.includes(row.id)) continue
      const voice = voiceOf(row)
      if (holdsVoiceSource(voice.state)) named.add(voice.sourceHash.value)
      if (voice.state === 'ready' && voice.audioHash !== null) named.add(voice.audioHash.value)
    }
    return named
  }

  async voiceBytes(eventId: EventId): Promise<number> {
    return this.voiceBytesNow(eventId)
  }

  async totalBytes(eventId: EventId): Promise<number> {
    return rowsOf(this.book, eventId).reduce((total, row) => {
      const voice = voiceOf(row)
      return voice.state === 'ready' ? total + (voice.audioByteSize ?? 0) : total
    }, 0)
  }

  async countReady(eventId: EventId): Promise<number> {
    return rowsOf(this.book, eventId).filter((row) => voiceOf(row).state === 'ready').length
  }

  async claimNext(now: Date): Promise<GuestbookEntry | null> {
    const due = this.book
      .everything()
      .filter((row) => row.voice !== null && voiceOf(row).isDue(now))
      // Oldest first, ties broken by id as bytes, the order the adapter's index gives.
      .sort(
        (left, right) =>
          voiceOf(left).queuedAt.getTime() - voiceOf(right).queuedAt.getTime() ||
          compareIds(left.id, right.id),
      )
    const next = due[0]
    if (next === undefined) return null

    const claimed = voiceOf(next).start(now)
    // Unreachable: `isDue` already proved the row is queued. Throwing keeps a real transition bug
    // from reading as an empty queue.
    if (!claimed.ok) throw new Error(`guestbook voice ${next.id} could not be claimed`)
    const moved = withVoice(next, claimed.value)
    this.book.put(moved)
    return moved
  }

  async requeueRunning(now: Date): Promise<readonly GuestbookEntry[]> {
    const recovered: GuestbookEntry[] = []
    for (const row of this.book.everything()) {
      if (row.voice === null || voiceOf(row).state !== 'running') continue
      const next = voiceOf(row).retry(now)
      if (!next.ok) throw new Error(`guestbook voice ${row.id} could not be recovered`)
      const moved = withVoice(row, next.value)
      this.book.put(moved)
      recovered.push(moved)
    }
    return recovered
  }

  async reapReserved(olderThan: Date): Promise<readonly GuestbookEntry[]> {
    return this.reap(
      (voice) => voice.state === 'reserved' && voice.queuedAt.getTime() <= olderThan.getTime(),
    )
  }

  async reapFailed(olderThan: Date): Promise<readonly GuestbookEntry[]> {
    return this.reap(
      (voice) =>
        voice.state === 'failed' &&
        voice.finishedAt !== null &&
        voice.finishedAt.getTime() <= olderThan.getTime(),
    )
  }

  private reap(doomedBy: (voice: GuestbookVoice) => boolean): readonly GuestbookEntry[] {
    const doomed = this.book
      .everything()
      .filter((row) => row.voice !== null && doomedBy(voiceOf(row)))
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || compareIds(left.id, right.id),
      )
    for (const row of doomed) this.book.remove(row.eventId, row.id)
    return doomed
  }
}
