import {
  failBook,
  finishBook,
  type AlbumBook,
  type BookResult,
} from '../../../domain/book/albumBook'
import type { BookFailureCode } from '../../../domain/book/albumBookStatus'
import { checkBookBytes, checkBookSize, estimateBookBytes } from '../../../domain/book/bookCaps'
import { bookExpiresAt } from '../../../domain/book/bookExpiry'
import { estimatePageCount } from '../../../domain/book/bookLayout'
import { BOOK_TEXTS, videosNoteFor } from '../../../domain/book/bookTexts'
import { pdfSafeText } from '../../../domain/book/pdfSafeText'
import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import type { Event } from '../../../domain/events/event'
import { Caption } from '../../../domain/photos/caption'
import type { Photo } from '../../../domain/photos/photo'
import { DisplayName } from '../../../domain/guests/displayName'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, PhotoId } from '../../../domain/shared/ids'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { BookFileStore } from '../../ports/bookFileStore'
import type { BookPhoto, BookRenderer } from '../../ports/bookRenderer'
import type { ClientRepository } from '../../ports/clientRepository'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { EventBus } from '../../ports/eventBus'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoPage, PhotoRepository } from '../../ports/photoRepository'
import { clientContextOf } from '../clients/clientContextOf'

/**
 * One pass of the photo book queue: claims the oldest asked-for book and makes it.
 *
 * It follows `transcodeNextClip`: a use case, so that every decision (does the book wait behind
 * a transcode, is the event still readable, is the book small enough, did a photo leave while
 * it rendered) is tested at 100 %, and `src/main/albumBookWorker.ts` owns only a timer.
 *
 * **What it re-checks, because the request may be old.** A book is queued, not made, when the
 * host asks. By the time it is claimed the client may have been suspended, the event taken down
 * by the operator or the function switched off for the client: the book then ends `failed` with
 * `unavailable` instead of blocking the queue (concurrency 1) or producing a file nobody may
 * read. The same question is asked again **before the closing page**, after the long part.
 *
 * **A photograph that left during the render must not be in the book.** The file is written to
 * a temporary name and renamed, and only then is `invalidated_at` read again: a fact stamped
 * after the render started makes the book `stale` and the file is deleted, never `done`.
 *
 * Captions and first names are read again here and never stored; only published photographs
 * created up to the book's `snapshotAt` go in, oldest first.
 */

/** Rows per read of the album. Each is one statement run to completion (see `albumEntries`). */
const PAGE_SIZE = 200
const DISPLAY = 'display' as const

export interface BuildAlbumBookPolicy {
  readonly maxPhotos: number
  readonly maxBytes: number
  readonly ttlDays: number
  /** Bytes of finished books the box keeps at once. */
  readonly maxTotalBytes: number
  /** How long a book waits behind video transcodes before it starts anyway. */
  readonly maxWaitMs: number
  /** The notice a lowered retention ceiling gives (for the purge date the book must not outlive). */
  readonly capNoticeDays: number
}

export interface BuildNextAlbumBookDeps {
  readonly events: EventRepository
  readonly clients: ClientRepository
  readonly guests: GuestRepository
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly books: AlbumBookRepository
  readonly bookFiles: BookFileStore
  readonly renderer: BookRenderer
  /** Only `countActive`: the book and the transcoder share one core. */
  readonly clips: Pick<ClipJobRepository, 'countActive'>
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
  readonly policy: BuildAlbumBookPolicy
  /** Whether the disk has room (the box's free-space guard); `false` fails the book `unavailable`. */
  readonly diskHasRoom: () => Promise<boolean>
}

export type BuildNextAlbumBookOutcome =
  | { readonly kind: 'idle' }
  /** A transcode is running and the oldest request has not waited long enough yet. */
  | { readonly kind: 'waiting' }
  | {
      readonly kind: 'built'
      readonly eventId: EventId
      readonly photoCount: number
      readonly pageCount: number
      readonly byteSize: number
    }
  /** A fact voided the book while it rendered: the file is gone, the host must ask again. */
  | { readonly kind: 'stale'; readonly eventId: EventId }
  | { readonly kind: 'failed'; readonly eventId: EventId; readonly code: BookFailureCode }
  /** The row was deleted or replaced while it rendered: the file is gone, nothing else happened. */
  | { readonly kind: 'superseded'; readonly eventId: EventId }
  /** Shutdown interrupted the render: the row stays `running`, boot recovery re-queues it. */
  | { readonly kind: 'aborted'; readonly eventId: EventId }

export type BuildNextAlbumBook = (signal?: AbortSignal) => Promise<BuildNextAlbumBookOutcome>

const failureCodeOf = (error: unknown): BookFailureCode => {
  if (DomainError.is(error)) {
    if (error.code === 'book.empty') return 'empty'
    if (error.code === 'book.tooLarge') return 'tooLarge'
    if (error.code === 'book.unavailable') return 'unavailable'
  }
  return 'unexpected'
}

const bookUnavailable = (): DomainError => DomainError.unexpected('book.unavailable')

export const makeBuildNextAlbumBook = ({
  events,
  clients,
  guests,
  photos,
  media,
  books,
  bookFiles,
  renderer,
  clips,
  bus,
  clock,
  logger,
  policy,
  diskHasRoom,
}: BuildNextAlbumBookDeps): BuildNextAlbumBook => {
  /** The event and its purge date, or `null` when nobody may be given a book of it now. */
  const readable = async (
    eventId: EventId,
  ): Promise<{ readonly event: Event; readonly purgeDate: Date | null } | null> => {
    const event = await events.findById(eventId)
    if (event === null || event.isTakenDown() || event.isClientSuspended()) return null
    const context = await clientContextOf(clients, event)
    if (context !== null && !context.ceilings.booksAllowed) return null
    const client = event.clientId === null ? null : await clients.findById(event.clientId)
    return { event, purgeDate: purgeDeadline(event, client, policy.capNoticeDays) }
  }

  /** The album, oldest first, frozen at the snapshot: pages, each a statement run to completion. */
  const albumOf = async function* (book: AlbumBook): AsyncIterable<readonly Photo[]> {
    let cursor: string | null = null
    do {
      const page: PhotoPage = await photos.list(book.eventId, {
        statuses: ['published'],
        order: 'asc',
        until: book.snapshotAt,
        limit: PAGE_SIZE,
        ...(cursor === null ? {} : { cursor }),
      })
      yield page.items
      cursor = page.nextCursor
    } while (cursor !== null)
  }

  const announce = (eventId: EventId): void => bus.publish({ type: 'book.changed', eventId })

  const giveUp = async (
    book: AlbumBook,
    code: BookFailureCode,
  ): Promise<BuildNextAlbumBookOutcome> => {
    // The row as it is now: one the host deleted or replaced during the render has no failure to
    // record (`failBook` only accepts a `running` book).
    const current = await books.find(book.eventId)
    const failed = current === null ? null : failBook(current, code)
    if (failed !== null && failed.ok) await books.save(failed.value)
    logger.warn('photo book failed', { eventId: book.eventId, code })
    announce(book.eventId)
    return { kind: 'failed', eventId: book.eventId, code }
  }

  return async (signal) => {
    const next = await books.findNextQueued()
    if (next === null) return { kind: 'idle' }

    // One core is shared with the video transcoder: a book waits for it, but never longer than
    // the box says, or a wedding that sends clips all evening would starve the book for good.
    const waited = clock.now().getTime() - next.requestedAt.getTime()
    if (waited < policy.maxWaitMs && (await clips.countActive()) > 0) return { kind: 'waiting' }

    const claimed = await books.claimNext(clock.now())
    if (claimed === null) return { kind: 'idle' }
    const { eventId } = claimed
    const startedAt = clock.now()
    announce(eventId)

    const context = await readable(eventId)
    if (context === null) return giveUp(claimed, 'unavailable')
    if (!(await diskHasRoom())) return giveUp(claimed, 'unavailable')

    // ------------------------------------------------------------ the first pass --
    // Rows and `stat` only, no byte read: what is in, what weighs how much, so that a book that
    // cannot fit is refused now, not abandoned at 90 % after the most expensive CPU of the event.
    let included = 0
    let videos = 0
    let displayBytes = 0
    for await (const page of albumOf(claimed)) {
      for (const photo of page) {
        if (photo.kind === 'clip') {
          videos += 1
          continue
        }
        const stored = await media.stat(eventId, photo.hashFor(DISPLAY), DISPLAY)
        // Counted as skipped by the render pass, which reads each photograph again.
        if (stored === null) {
          continue
        }
        included += 1
        displayBytes += stored.byteSize
      }
    }

    const size = checkBookSize(included, policy.maxPhotos)
    if (!size.ok) return giveUp(claimed, failureCodeOf(size.error))
    const estimate = estimateBookBytes(displayBytes)
    const weight = checkBookBytes(estimate, policy.maxBytes)
    if (!weight.ok) return giveUp(claimed, failureCodeOf(weight.error))
    if ((await books.doneBytes()) + estimate > policy.maxTotalBytes) {
      return giveUp(claimed, 'unavailable')
    }

    // ----------------------------------------------------------- the render pass --
    const { options } = claimed
    const texts = BOOK_TEXTS[options.language]
    let rendered = 0
    let skippedAtRender = 0

    const namesOf = async (page: readonly Photo[]): Promise<ReadonlyMap<PhotoId, string>> => {
      const senders = new Map<PhotoId, GuestId>()
      for (const photo of page) {
        if (photo.author.kind === 'guest') senders.set(photo.id, photo.author.guestId)
      }
      const names = await guests.findNamesByIds(eventId, [...new Set(senders.values())])
      const byPhoto = new Map<PhotoId, string>()
      for (const [photoId, guestId] of senders) {
        const name = names.get(guestId)
        if (name !== undefined) byPhoto.set(photoId, name)
      }
      return byPhoto
    }

    const photosOf = async function* (): AsyncIterable<BookPhoto> {
      for await (const page of albumOf(claimed)) {
        const authors = options.showAuthors ? await namesOf(page) : new Map<PhotoId, string>()
        for (const photo of page) {
          if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
          if (photo.kind === 'clip') continue
          const bytes = await media.read(eventId, photo.hashFor(DISPLAY), DISPLAY)
          if (bytes === null) {
            // Skipped, not fatal, as the ZIP does: one orphaned row must not sink the book.
            logger.warn('photo book skipped a photograph whose file is missing', { eventId })
            skippedAtRender += 1
            continue
          }
          rendered += 1
          yield {
            bytes,
            caption: options.showCaptions ? textOrNull(photo.caption, Caption.maxLength) : null,
            author: textOrNull(authors.get(photo.id) ?? null, DisplayName.maxLength),
          }
        }
      }
      // After the long part, before the closing page: the event may have been taken down or the
      // client suspended while the photographs were being drawn.
      if ((await readable(eventId)) === null) throw bookUnavailable()
    }

    let byteSize: number
    try {
      byteSize = await bookFiles.write(
        eventId,
        renderer.render({
          layout: options.layout,
          cover: {
            title: pdfSafeText(options.title, 80),
            subtitle: pdfSafeText(options.subtitle, 80),
          },
          closing: {
            createdWith: texts.createdWith,
            videosNote: videosNoteFor(videos, options.language),
          },
          photos: photosOf(),
        }),
        { maxBytes: policy.maxBytes },
      )
    } catch (error) {
      if (signal?.aborted === true) return { kind: 'aborted', eventId }
      if (!DomainError.is(error)) logger.error('photo book render failed', { eventId })
      return giveUp(claimed, failureCodeOf(error))
    }

    // --------------------------------------------------------------- the verdict --
    const doneAt = clock.now()
    const result: BookResult = {
      photoCount: rendered,
      skippedCount: skippedAtRender,
      pageCount: estimatePageCount(options.layout, rendered),
      byteSize,
      expiresAt: bookExpiresAt(doneAt, policy.ttlDays, context.purgeDate),
    }

    // Read again, **after** the file exists: a fact stamped while it rendered is in this row.
    const current = await books.find(eventId)
    // `finishBook` refuses anything that is not `running`: a row replaced by a new request
    // (queued) or deleted by the host has no verdict to receive.
    const finished = current === null ? null : finishBook(current, result, doneAt)
    if (finished === null || !finished.ok) {
      await bookFiles.delete(eventId)
      announce(eventId)
      return { kind: 'superseded', eventId }
    }
    await books.save(finished.value)
    announce(eventId)

    if (finished.value.status === 'stale') {
      await bookFiles.delete(eventId)
      logger.info('photo book voided while it rendered', { eventId })
      return { kind: 'stale', eventId }
    }
    logger.info('photo book built', {
      eventId,
      photos: rendered,
      skipped: result.skippedCount,
      pages: result.pageCount,
      bytes: byteSize,
      durationMs: doneAt.getTime() - startedAt.getTime(),
    })
    return {
      kind: 'built',
      eventId,
      photoCount: rendered,
      pageCount: result.pageCount,
      byteSize,
    }
  }
}

/** A caption or a name made drawable; `null` when nothing drawable remains. */
const textOrNull = (
  text: { readonly toString: () => string } | string | null,
  maxLength: number,
): string | null => {
  if (text === null) return null
  const safe = pdfSafeText(text.toString(), maxLength)
  return safe === '' ? null : safe
}
