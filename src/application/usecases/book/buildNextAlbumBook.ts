import { type AlbumBook, type BookResult } from '../../../domain/book/albumBook'
import type { BookFailureCode, BookPrintSkipped } from '../../../domain/book/albumBookStatus'
import { checkBookBytes, checkBookSize } from '../../../domain/book/bookCaps'
import { pickCoverPhoto } from '../../../domain/book/bookCover'
import {
  BOOK_PRINT_DPI,
  BOOK_SCREEN_DPI,
  estimatePlanBytes,
} from '../../../domain/book/bookEstimate'
import { bookExpiresAt } from '../../../domain/book/bookExpiry'
import type { BookMessage, BookPhoto } from '../../../domain/book/bookInput'
import { composeBook, type PlanPage } from '../../../domain/book/bookPlan'
import { planForPrint } from '../../../domain/book/bookPrint'
import { BOOK_STYLE_DEFS, resolveBookColours } from '../../../domain/book/bookStyles'
import { pageCountOf } from '../../../domain/book/bookTemplates'
import { BOOK_TEXTS, videosNoteFor } from '../../../domain/book/bookTexts'
import { formatLongDate } from '../../../domain/book/bookTime'
import { pdfSafeText } from '../../../domain/book/pdfSafeText'
import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import type { Event } from '../../../domain/events/event'
import { MAX_ENTRIES_PER_EVENT } from '../../../domain/guestbook/guestbookLimits'
import { DisplayName } from '../../../domain/guests/displayName'
import { Caption } from '../../../domain/photos/caption'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { EVENT_LOGO } from '../../../domain/photos/mediaVariant'
import type { Photo } from '../../../domain/photos/photo'
import { totalReactions } from '../../../domain/reactions/reactionTally'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, MissionId, PhotoId } from '../../../domain/shared/ids'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { BookChunk, BookFileSetResult, BookFileStore } from '../../ports/bookFileStore'
import type { BookRenderer, PageTexts } from '../../ports/bookRenderer'
import type { ClientRepository } from '../../ports/clientRepository'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { MissionRepository } from '../../ports/missionRepository'
import type { PhotoPage, PhotoRepository } from '../../ports/photoRepository'
import type { ReactionRepository } from '../../ports/reactionRepository'
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
  /** What the printer version (interior and cover together) may weigh before it is abandoned. */
  readonly maxPrintBytes: number
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
  /** Only the hearts, read once at the first pass and frozen in the plan. */
  readonly reactions: Pick<ReactionRepository, 'countsForEvent'>
  /** The messages a book may print, and one message by id (its words are read again at render time). */
  readonly guestbook: Pick<
    GuestbookRepository,
    'listWrittenForBook' | 'listByStatuses' | 'findById'
  >
  /** The prompts of the missions the photographs answer. */
  readonly missions: Pick<MissionRepository, 'findByIds'>
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

/** The screen book opens with its cover and the inside of it: two pages before the plan's first. */
const SCREEN_EXTRA_PAGES = 2

/** What the render pass needs of a photograph beyond its place in the plan: kept per selected row. */
interface PhotoMeta {
  readonly hash: ContentHash
  readonly guestId: GuestId | null
  readonly missionId: MissionId | null
}

/** A result that carries nothing: finishing a voided book with it is how the domain makes it `stale`. */
const emptyResult: BookResult = {
  photoCount: 0,
  skippedCount: 0,
  pageCount: 0,
  byteSize: 0,
  selectedCount: 0,
  printByteSize: null,
  printSkipped: null,
  expiresAt: new Date(0),
}

export const makeBuildNextAlbumBook = ({
  events,
  clients,
  guests,
  photos,
  reactions,
  guestbook,
  missions,
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
    if (event === null || !event.isReachable()) return null
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

  /** A fact that voided the book at or after the instant its render started. */
  const isVoided = async (eventId: EventId): Promise<boolean> => {
    const current = await books.find(eventId)
    return (
      current !== null &&
      current.status === 'running' &&
      current.invalidatedAt !== null &&
      current.startedAt !== null &&
      current.invalidatedAt.getTime() >= current.startedAt.getTime()
    )
  }

  const announce = (eventId: EventId): void => bus.publish({ type: 'book.changed', eventId })

  const giveUp = async (
    book: AlbumBook,
    code: BookFailureCode,
  ): Promise<BuildNextAlbumBookOutcome> => {
    // Atomic in the repository: a row the host deleted or replaced during the render has no
    // failure to record, and nothing is written.
    await books.finish(book.eventId, { kind: 'failed', code }, clock.now())
    logger.warn('photo book failed', { eventId: book.eventId, code })
    announce(book.eventId)
    return { kind: 'failed', eventId: book.eventId, code }
  }

  /** Everything after the claim. */
  const buildClaimed = async (
    claimed: AlbumBook,
    signal: AbortSignal | undefined,
  ): Promise<BuildNextAlbumBookOutcome> => {
    const { eventId } = claimed
    const startedAt = clock.now()
    announce(eventId)

    const context = await readable(eventId)
    if (context === null) return giveUp(claimed, 'unavailable')
    if (!(await diskHasRoom())) return giveUp(claimed, 'unavailable')

    // ------------------------------------------------------------ the first pass --
    // Rows, `stat` and one read of the hearts, no photograph byte: what is in, who took it, how loved
    // it is. The hearts are read **once** here and frozen in the plan (spec 26): everything later
    // (the score, the favourites, the badge, the evening in numbers) depends on them, never on the
    // values the next read would give.
    const { options } = claimed
    const heartsByPhoto = await reactions.countsForEvent(eventId)
    const rows: BookPhoto[] = []
    const rowMeta = new Map<PhotoId, PhotoMeta>()
    let videos = 0
    let skipped = 0
    let hearts = 0
    for await (const page of albumOf(claimed)) {
      for (const photo of page) {
        if (photo.kind === 'clip') {
          videos += 1
          continue
        }
        const stored = await media.stat(eventId, photo.hashFor(DISPLAY), DISPLAY)
        // A row whose file is gone is left out of the plan, and counted.
        if (stored === null) {
          skipped += 1
          continue
        }
        const counts = heartsByPhoto.get(photo.id)
        const photoHearts = counts === undefined ? 0 : totalReactions(counts)
        hearts += photoHearts
        const guestId = photo.author.kind === 'guest' ? photo.author.guestId : null
        rows.push({
          id: photo.id,
          createdAt: photo.createdAt,
          width: photo.dimensions.width,
          height: photo.dimensions.height,
          guestId,
          reactions: photoHearts,
          highlighted: photo.highlightedAt !== null,
          missionId: photo.missionId,
          challengeId: photo.challengeId ?? null,
          hasCaption: photo.caption !== null,
        })
        rowMeta.set(photo.id, {
          hash: photo.hashFor(DISPLAY),
          guestId,
          missionId: photo.missionId,
        })
      }
    }

    const written = options.includeGuestbook
      ? await guestbook.listWrittenForBook(eventId, claimed.snapshotAt, MAX_ENTRIES_PER_EVENT)
      : []
    const messages: BookMessage[] = written.map((entry) => ({
      id: entry.id,
      guestId: entry.guestId,
      createdAt: entry.createdAt,
      length: entry.text.value.length,
    }))
    const voices = options.includeGuestbook
      ? (await guestbook.listByStatuses(eventId, ['published'], MAX_ENTRIES_PER_EVENT)).filter(
          (entry) => entry.voice !== null,
        ).length
      : 0

    const plan = composeBook(
      {
        photos: rows,
        messages,
        counts: {
          photos: rows.length,
          photographers: new Set(rows.flatMap((row) => (row.guestId === null ? [] : [row.guestId])))
            .size,
          hearts,
          messages: messages.length,
          voices,
          videos,
        },
      },
      options,
    )

    const size = checkBookSize(plan.selectedCount, policy.maxPhotos)
    if (!size.ok) return giveUp(claimed, failureCodeOf(size.error))
    const estimate = estimatePlanBytes(plan.pages, BOOK_SCREEN_DPI)
    const weight = checkBookBytes(estimate, policy.maxBytes)
    if (!weight.ok) return giveUp(claimed, failureCodeOf(weight.error))
    if ((await books.doneBytes()) + estimate > policy.maxTotalBytes) {
      return giveUp(claimed, 'unavailable')
    }

    // The printer version is decided now, from the plan: too many pages, or too heavy, and the
    // screen book is made alone (neither is a failure of the book).
    let printPages: readonly PlanPage[] | null = null
    let printSkipped: BookPrintSkipped | null = null
    if (options.printVersion) {
      const printer = planForPrint(plan.pages, options.style, new Map(rows.map((r) => [r.id, r])))
      if (printer.kind === 'tooManyPages') {
        printSkipped = 'tooManyPages'
      } else if (estimatePlanBytes(printer.pages, BOOK_PRINT_DPI) > policy.maxPrintBytes) {
        printSkipped = 'tooLarge'
      } else {
        printPages = printer.pages
      }
    }

    // The plan is written as the render starts, and only on a book no fact has voided yet.
    if (!(await books.recordPlan(eventId, plan))) {
      announce(eventId)
      const current = await books.find(eventId)
      if (current === null || current.status !== 'running') return { kind: 'superseded', eventId }
      // Voided before the render began: finishing it is how the domain turns it `stale`.
      await books.finish(eventId, { kind: 'finished', result: emptyResult }, clock.now())
      return { kind: 'stale', eventId }
    }

    // ----------------------------------------------------------- the render pass --
    const texts = BOOK_TEXTS[options.language]
    const promptOfMission = new Map<MissionId, string>()
    const missionIds = [
      ...new Set(rows.flatMap((row) => (row.missionId === null ? [] : [row.missionId]))),
    ]
    if (missionIds.length > 0) {
      for (const mission of await missions.findByIds(eventId, missionIds)) {
        const prompt = textOrNull(mission.prompt, 80)
        if (prompt !== null) promptOfMission.set(mission.id, prompt)
      }
    }

    const namesOf = async (
      ids: readonly (GuestId | null | undefined)[],
    ): Promise<ReadonlyMap<GuestId, string>> => {
      if (!options.showAuthors) return new Map()
      const wanted = [
        ...new Set(ids.flatMap((id) => (id === null || id === undefined ? [] : [id]))),
      ]
      return guests.findNamesByIds(eventId, wanted)
    }

    const pageTexts = async (page: PlanPage): Promise<PageTexts> => {
      if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      const metas = page.slots.map((slot) => rowMeta.get(slot.photoId) as PhotoMeta)
      // Captions and messages are read again, here, by id: what a guest edited or erased since the
      // first pass is what is printed (and a book that holds a removed one is made stale by the
      // invalidation, not by this read).
      const current = await Promise.all(
        page.slots.map((slot) => photos.findById(eventId, slot.photoId)),
      )
      const found = await Promise.all(
        (page.messageIds ?? []).map((id) => guestbook.findById(eventId, id)),
      )
      // Only a message that is still published and still has words goes in the book (a taken-down
      // one is invisible to `findById` already).
      const entries = found.map((entry) =>
        entry !== null && entry.status === 'published' ? entry : null,
      )
      const names = await namesOf([
        ...metas.map((meta) => meta.guestId),
        ...entries.map((entry) => entry?.guestId),
        ...(page.template === 'thanks' ? plan.photographers.map((p) => p.guestId) : []),
      ])
      // A guest the book has no name for (none, or removed) simply has no line.
      const nameOf = (guestId: GuestId | null | undefined): string | null =>
        textOrNull(names.get(guestId as GuestId) ?? null, DisplayName.maxLength)
      return {
        captions: current.map((photo) =>
          options.showCaptions ? textOrNull(photo?.caption ?? null, Caption.maxLength) : null,
        ),
        authors: metas.map((meta) => nameOf(meta.guestId)),
        missions: metas.map((meta) =>
          meta.missionId === null ? null : (promptOfMission.get(meta.missionId) ?? null),
        ),
        messages: entries.flatMap((entry) => {
          const value = entry?.text?.value
          return value === undefined
            ? []
            : [{ text: pdfSafeText(value, 500), author: nameOf(entry?.guestId) }]
        }),
        photographers:
          page.template === 'thanks'
            ? plan.photographers.flatMap((p) => {
                const name = nameOf(p.guestId)
                return name === null ? [] : [{ name, photoCount: p.photoCount }]
              })
            : [],
      }
    }

    const { event } = context
    const logo = event.settings.logo
    const render = renderer.render({
      plan,
      printPages,
      style: BOOK_STYLE_DEFS[options.style],
      colours: resolveBookColours(options.style, event.settings.theme.accentHue),
      language: options.language,
      timeZone: options.timeZone,
      texts,
      cover: {
        title: pdfSafeText(options.title, 80),
        subtitle:
          options.subtitle === ''
            ? formatLongDate(rows[0]!.createdAt.getTime(), options.timeZone, options.language)
            : pdfSafeText(options.subtitle, 80),
        photoId: pickCoverPhoto(plan),
      },
      logo: logo === null ? null : await media.read(eventId, logo, EVENT_LOGO),
      photo: async (id) => {
        if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
        const bytes = await media.read(eventId, (rowMeta.get(id) as PhotoMeta).hash, DISPLAY)
        if (bytes === null) throw bookUnavailable()
        return bytes
      },
      pageTexts,
      printStopped: () => printDropped,
      closing: {
        videosNote: videosNoteFor(videos, options.language),
        voicesNote: voices === 0 ? null : texts.voicesNotIncluded(voices),
        extraMessagesNote:
          plan.extraMessages === 0 ? null : texts.extraMessages(plan.extraMessages),
      },
    })

    /** After the long part, before the end: the event may have been taken down while it was drawn. */
    const guarded = async function* (): AsyncIterable<BookChunk> {
      yield* render
      if ((await readable(eventId)) === null) throw bookUnavailable()
    }

    let set: BookFileSetResult
    let printDropped = false
    try {
      set = await bookFiles.writeSet(eventId, guarded(), {
        maxBytes: { screen: policy.maxBytes, print: policy.maxPrintBytes },
        onPrintDropped: () => {
          printDropped = true
        },
      })
    } catch (error) {
      if (signal?.aborted === true) return { kind: 'aborted', eventId }
      if (!DomainError.is(error)) logger.error('photo book render failed', { eventId })
      // A file that vanished because the photograph was removed is the removal's doing: the book is
      // stale, not failed.
      if (await isVoided(eventId)) {
        await books.finish(eventId, { kind: 'finished', result: emptyResult }, clock.now())
        announce(eventId)
        return { kind: 'stale', eventId }
      }
      return giveUp(claimed, failureCodeOf(error))
    }
    const byteSize = set.screen
    const printBytes =
      set.printInterior === null || set.printCover === null
        ? null
        : set.printInterior + set.printCover
    const rendered = plan.selectedCount

    // --------------------------------------------------------------- the verdict --
    const doneAt = clock.now()
    const result: BookResult = {
      photoCount: rendered,
      skippedCount: skipped,
      // What the host reads is what the file has: the cover and its inside count as pages.
      pageCount: pageCountOf(plan.pages) + SCREEN_EXTRA_PAGES,
      byteSize,
      selectedCount: plan.selectedCount,
      printByteSize: printBytes,
      printSkipped: set.printSkipped ?? printSkipped,
      expiresAt: bookExpiresAt(doneAt, policy.ttlDays, context.purgeDate),
    }

    // Decided in the repository, on the row as it is **after** the file exists: a fact stamped
    // while it rendered is in that row, and one replaced by a new request (queued) or deleted by
    // the host has no verdict to receive.
    if (signal?.aborted === true) {
      await bookFiles.delete(eventId)
      return { kind: 'aborted', eventId }
    }
    const finished = await books.finish(eventId, { kind: 'finished', result }, doneAt)
    if (finished === 'superseded') {
      await bookFiles.delete(eventId)
      announce(eventId)
      return { kind: 'superseded', eventId }
    }
    announce(eventId)

    if (finished === 'stale') {
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

  return async (signal) => {
    const next = await books.findNextQueued()
    if (next === null) return { kind: 'idle' }

    // One core is shared with the video transcoder: a book waits for it, but never longer than
    // the box says, or a wedding that sends clips all evening would starve the book for good.
    const waited = clock.now().getTime() - next.requestedAt.getTime()
    if (waited < policy.maxWaitMs && (await clips.countActive()) > 0) return { kind: 'waiting' }

    const claimed = await books.claimNext(clock.now())
    if (claimed === null) return { kind: 'idle' }

    try {
      return await buildClaimed(claimed, signal)
    } catch (error) {
      // Whatever failed after the claim (the disk probe, a read of the album, the verdict's own
      // write), the book is given up like the render's own failure is: left `running` it would
      // answer `book.alreadyRunning` to every new request until the next boot. A shutdown is
      // the one exception, as in the render: the row stays `running` for the boot to re-queue.
      if (signal?.aborted === true) return { kind: 'aborted', eventId: claimed.eventId }
      if (!DomainError.is(error))
        logger.error('photo book failed unexpectedly', { eventId: claimed.eventId })
      return giveUp(claimed, failureCodeOf(error))
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
