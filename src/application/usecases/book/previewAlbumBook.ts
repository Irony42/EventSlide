import { checkBookSize } from '../../../domain/book/bookCaps'
import { chapterSubtitleText, chapterTitleText } from '../../../domain/book/bookChapters'
import {
  chapterNumeral,
  contentsEntries,
  type ContentsEntry,
} from '../../../domain/book/bookContents'
import { pickCoverPhoto } from '../../../domain/book/bookCover'
import type { BookMessage, BookPhoto } from '../../../domain/book/bookInput'
import type { BookOptionsV2, BookSelection, BookStyle } from '../../../domain/book/bookOptionsV2'
import { composeBook } from '../../../domain/book/bookPlan'
import { resolveBookColours, type BookColours } from '../../../domain/book/bookStyles'
import { BOOK_TEMPLATES, pageCountOf, type TemplateId } from '../../../domain/book/bookTemplates'
import { BOOK_TEXTS, videosNoteFor } from '../../../domain/book/bookTexts'
import { formatLongDate, normalizeTimeZone } from '../../../domain/book/bookTime'
import { pdfSafeText } from '../../../domain/book/pdfSafeText'
import type { EventLanguage } from '../../../domain/events/eventLanguage'
import { MAX_ENTRIES_PER_EVENT } from '../../../domain/guestbook/guestbookLimits'
import { DisplayName } from '../../../domain/guests/displayName'
import { Caption } from '../../../domain/photos/caption'
import type { Photo } from '../../../domain/photos/photo'
import { totalReactions } from '../../../domain/reactions/reactionTally'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, MissionId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { MissionRepository } from '../../ports/missionRepository'
import type { PhotoPage, PhotoRepository } from '../../ports/photoRepository'
import type { ReactionRepository } from '../../ports/reactionRepository'
import { requireReadable } from '../shared/eventRole'

/**
 * What the host's book page draws before the book exists (spec 26, the live preview).
 *
 * **It runs the plan the PDF is made from**: the same `composeBook`, on the event's real published
 * photographs read now (the book itself reads them at its own snapshot), with the same options, and
 * the same text rules (`pdfSafeText`, the caption and name ceilings, the date under an empty
 * subtitle, the contents lines). The browser only draws what this says; it re-invents nothing.
 *
 * Reads and writes nothing. A photograph whose file has gone is not looked for here (the build
 * skips it with a `stat`): a preview must stay cheap, so on such an album the real book can hold one
 * photograph fewer than this says, and the build's own count is the one the host reads once done.
 * The caller is a moderator of the event (the route says so): captions, first names and guest-book
 * words are read for them only.
 */

const PAGE_SIZE = 200
/** The photographers listed on the thanks page of a preview: more are cut, the PDF fits them all. */
const MAX_THANKED = 300

export interface PreviewAlbumBookInput {
  readonly eventId: EventId
  readonly title: string
  readonly subtitle?: string | undefined
  readonly language?: EventLanguage | undefined
  readonly style: BookStyle
  readonly selection: BookSelection
  readonly showAuthors: boolean
  readonly showCaptions: boolean
  readonly includeGuestbook: boolean
  readonly timeZone?: string | undefined
}

export interface BookPreviewPhoto {
  readonly id: PhotoId
  readonly width: number
  readonly height: number
  readonly caption: string | null
  readonly author: string | null
  readonly mission: string | null
  readonly hearts: number
}

export interface BookPreviewPage {
  readonly template: TemplateId
  /** Page widths the template covers: a `wide` one runs over a double page. */
  readonly span: 1 | 2
  readonly chapter: number | null
  readonly photos: readonly BookPreviewPhoto[]
  readonly messages: readonly { readonly text: string; readonly author: string | null }[]
  /** The first `messages` page carries the guest book's heading. */
  readonly firstMessages: boolean
}

export interface BookPreview {
  readonly style: BookStyle
  readonly colours: BookColours
  readonly language: EventLanguage
  readonly cover: {
    readonly title: string
    readonly subtitle: string
    readonly photo: BookPreviewPhoto
  }
  /** The plan's pages in order; the screen book adds the cover before and an inside cover. */
  readonly pages: readonly BookPreviewPage[]
  /** What the PDF will say it has: the plan's pages plus the cover and its inside. */
  readonly pageCount: number
  readonly photoCount: number
  /** Published photographs in the album now (clips left out). */
  readonly albumPhotos: number
  readonly chapters: readonly {
    readonly index: number
    readonly numeral: string
    readonly title: string
    readonly subtitle: string
    readonly firstPage: number
  }[]
  readonly contents: readonly ContentsEntry[]
  readonly stats: {
    readonly photos: number
    readonly photographers: number
    readonly hearts: number
    readonly messages: number
  }
  readonly texts: {
    readonly contents: string
    readonly statsTitle: string
    readonly statPhotos: string
    readonly statPhotographers: string
    readonly statHearts: string
    readonly statMessages: string
    readonly favourites: string
    readonly guestbook: string
    readonly createdWith: string
  }
  readonly thanks: {
    readonly heading: string
    readonly names: readonly { readonly name: string; readonly photoCount: number }[]
  }
  readonly closingNotes: readonly string[]
}

export type PreviewAlbumBook = (
  input: PreviewAlbumBookInput,
) => Promise<Result<BookPreview, DomainError>>

export interface PreviewAlbumBookDeps {
  readonly events: EventRepository
  readonly photos: Pick<PhotoRepository, 'list'>
  readonly reactions: Pick<ReactionRepository, 'countsForEvent'>
  readonly guests: Pick<GuestRepository, 'findNamesByIds'>
  readonly guestbook: Pick<GuestbookRepository, 'listWrittenForBook' | 'listByStatuses'>
  readonly missions: Pick<MissionRepository, 'findByIds'>
  readonly clock: Clock
  /** `BOOK_MAX_PHOTOS` and `BOOK_MAX_MESSAGES`: the ceilings of the real book. */
  readonly policy: { readonly maxPhotos: number; readonly maxMessages: number }
}

const textOrNull = (text: string | null, maxLength: number): string | null => {
  if (text === null) return null
  const safe = pdfSafeText(text, maxLength)
  return safe === '' ? null : safe
}

export const makePreviewAlbumBook =
  ({
    events,
    photos,
    reactions,
    guests,
    guestbook,
    missions,
    clock,
    policy,
  }: PreviewAlbumBookDeps): PreviewAlbumBook =>
  async (input) => {
    const event = await events.findById(input.eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const readable = requireReadable(event)
    if (!readable.ok) return readable
    const { eventId } = input
    const language = input.language ?? event.settings.wallLanguage
    const timeZone = normalizeTimeZone(input.timeZone)
    const options: BookOptionsV2 = {
      title: input.title,
      subtitle: input.subtitle ?? '',
      language,
      style: input.style,
      selection: input.selection,
      showAuthors: input.showAuthors,
      showCaptions: input.showCaptions,
      includeGuestbook: input.includeGuestbook,
      printVersion: false,
      timeZone,
    }

    const now = clock.now()
    const heartsByPhoto = await reactions.countsForEvent(eventId)
    const rows: BookPhoto[] = []
    const entities = new Map<PhotoId, Photo>()
    let videos = 0
    let hearts = 0
    let cursor: string | null = null
    do {
      const page: PhotoPage = await photos.list(eventId, {
        statuses: ['published'],
        order: 'asc',
        until: now,
        limit: PAGE_SIZE,
        ...(cursor === null ? {} : { cursor }),
      })
      for (const photo of page.items) {
        if (photo.kind === 'clip') {
          videos += 1
          continue
        }
        const counts = heartsByPhoto.get(photo.id)
        const photoHearts = counts === undefined ? 0 : totalReactions(counts)
        hearts += photoHearts
        rows.push({
          id: photo.id,
          createdAt: photo.createdAt,
          width: photo.dimensions.width,
          height: photo.dimensions.height,
          guestId: photo.author.kind === 'guest' ? photo.author.guestId : null,
          reactions: photoHearts,
          highlighted: photo.highlightedAt !== null,
          missionId: photo.missionId,
          challengeId: photo.challengeId ?? null,
          hasCaption: photo.caption !== null,
        })
        entities.set(photo.id, photo)
      }
      cursor = page.nextCursor
    } while (cursor !== null)

    // The same gates the build applies, so the preview refuses what the book would fail on.
    if (rows.length === 0) return err(DomainError.conflict('book.empty'))
    if (input.selection.kind === 'all') {
      const size = checkBookSize(rows.length, policy.maxPhotos)
      if (!size.ok) return size
    }

    const written = options.includeGuestbook
      ? await guestbook.listWrittenForBook(eventId, now, MAX_ENTRIES_PER_EVENT)
      : []
    const messageEntries = written.slice(0, policy.maxMessages)
    const messages: BookMessage[] = messageEntries.map((entry) => ({
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
          messages: written.length,
          voices,
          videos,
        },
      },
      options,
    )

    // ---- the words, only for what the plan keeps
    const metaOf = new Map(rows.map((row) => [row.id, row]))
    const missionIds = new Set<MissionId>()
    for (const page of plan.pages) {
      for (const slot of page.slots) {
        const id = metaOf.get(slot.photoId)!.missionId
        if (id !== null) missionIds.add(id)
      }
    }
    const promptOfMission = new Map<MissionId, string>()
    if (missionIds.size > 0) {
      for (const mission of await missions.findByIds(eventId, [...missionIds])) {
        const prompt = textOrNull(mission.prompt.toString(), 80)
        if (prompt !== null) promptOfMission.set(mission.id, prompt)
      }
    }
    const entryById = new Map(messageEntries.map((entry) => [entry.id, entry]))
    const wanted = new Set<GuestId>()
    if (options.showAuthors) {
      for (const page of plan.pages) {
        for (const slot of page.slots) {
          const id = metaOf.get(slot.photoId)!.guestId
          if (id !== null) wanted.add(id)
        }
        for (const id of page.messageIds ?? []) {
          wanted.add(entryById.get(id)!.guestId)
        }
      }
      for (const photographer of plan.photographers.slice(0, MAX_THANKED)) {
        wanted.add(photographer.guestId)
      }
    }
    const names =
      wanted.size === 0
        ? new Map<GuestId, string>()
        : await guests.findNamesByIds(eventId, [...wanted])
    // Nobody is asked for when names are off, so the table is empty and every answer is `null`.
    const nameOf = (guestId: GuestId | null): string | null =>
      guestId === null ? null : textOrNull(names.get(guestId) ?? null, DisplayName.maxLength)

    const previewPhoto = (id: PhotoId): BookPreviewPhoto => {
      const row = metaOf.get(id)!
      const photo = entities.get(id)!
      return {
        id,
        width: row.width,
        height: row.height,
        caption: options.showCaptions
          ? textOrNull(photo.caption === null ? null : photo.caption.toString(), Caption.maxLength)
          : null,
        author: nameOf(row.guestId),
        mission: row.missionId === null ? null : (promptOfMission.get(row.missionId) ?? null),
        hearts: plan.hearts[id] ?? 0,
      }
    }

    let messagesSeen = false
    const pages: BookPreviewPage[] = plan.pages.map((page) => {
      const isMessages = page.template === 'messages'
      const first = isMessages && !messagesSeen
      if (isMessages) messagesSeen = true
      return {
        template: page.template,
        span: BOOK_TEMPLATES[page.template].span,
        chapter: page.chapter ?? null,
        photos: page.slots.map((slot) => previewPhoto(slot.photoId)),
        messages: (page.messageIds ?? []).map((id) => {
          const entry = entryById.get(id)!
          return { text: pdfSafeText(entry.text.value, 500), author: nameOf(entry.guestId) }
        }),
        firstMessages: first,
      }
    })

    const texts = BOOK_TEXTS[language]
    // A plan of a non-empty album always has a photograph, hence a cover.
    const coverId = pickCoverPhoto(plan)!
    const thanked = plan.photographers.slice(0, MAX_THANKED).flatMap((p) => {
      const name = nameOf(p.guestId)
      return name === null ? [] : [{ name, photoCount: p.photoCount }]
    })
    const closingNotes = [
      videosNoteFor(videos, language),
      voices === 0 ? null : texts.voicesNotIncluded(voices),
      plan.extraMessages === 0 ? null : texts.extraMessages(plan.extraMessages),
    ].filter((note): note is string => note !== null)

    return ok({
      style: options.style,
      colours: resolveBookColours(options.style, event.settings.theme.accentHue),
      language,
      cover: {
        title: pdfSafeText(options.title, 80),
        subtitle:
          options.subtitle === ''
            ? formatLongDate(rows[0]!.createdAt.getTime(), timeZone, language)
            : pdfSafeText(options.subtitle, 80),
        photo: previewPhoto(coverId),
      },
      pages,
      pageCount: pageCountOf(plan.pages) + 2,
      photoCount: plan.selectedCount,
      albumPhotos: rows.length,
      chapters: plan.chapters.map((chapter) => ({
        index: chapter.index,
        numeral: chapterNumeral(chapter.index),
        title: chapterTitleText(chapter.title, language),
        subtitle: chapterSubtitleText(chapter, timeZone, language),
        firstPage: chapter.firstPage,
      })),
      contents: contentsEntries(plan, language),
      stats: {
        photos: plan.counts.photos,
        photographers: plan.counts.photographers,
        hearts: plan.counts.hearts,
        messages: plan.includedMessages,
      },
      texts: {
        contents: texts.contents,
        statsTitle: texts.statsTitle,
        statPhotos: texts.statPhotos,
        statPhotographers: texts.statPhotographers,
        statHearts: texts.statHearts,
        statMessages: texts.statMessages,
        favourites: texts.favourites,
        guestbook: texts.guestbook,
        createdWith: texts.createdWith,
      },
      thanks: {
        heading:
          thanked.length > 0
            ? texts.thanksTo(plan.photographers.length)
            : texts.thanksAnonymous(plan.photographers.length),
        names: thanked,
      },
      closingNotes,
    })
  }
