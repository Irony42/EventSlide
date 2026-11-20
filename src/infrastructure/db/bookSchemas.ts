import { z } from 'zod'
import { BOOK_STYLES, type BookOptionsV2 } from '../../domain/book/bookOptionsV2'
import type { BookPlan } from '../../domain/book/bookPlan'
import { TEMPLATE_IDS } from '../../domain/book/bookTemplates'
import { EVENT_LANGUAGES } from '../../domain/events/eventLanguage'
import { asGuestbookEntryId, asGuestId, asPhotoId } from '../../domain/shared/ids'

/**
 * What `album_books` keeps as JSON, and the only way back in: a row is not trusted, so both
 * documents are parsed on the way out of the database and validated on the way in.
 */

const count = z.number().int().min(0)
const id = z.string().min(1).max(128)

/** The host's choices as stored (spec 26, v2). Strict and unique: the migration rewrites every old row to it. */
export const bookOptionsSchema: z.ZodType<BookOptionsV2, unknown> = z
  .object({
    title: z.string(),
    subtitle: z.string(),
    language: z.enum(EVENT_LANGUAGES),
    style: z.enum(BOOK_STYLES),
    selection: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('all') }),
      z.strictObject({
        kind: z.literal('best'),
        target: z.union([z.literal(60), z.literal(120), z.literal(200)]),
      }),
    ]),
    showAuthors: z.boolean(),
    showCaptions: z.boolean(),
    includeGuestbook: z.boolean(),
    printVersion: z.boolean(),
    timeZone: z.string().min(1).max(64),
  })
  .strict()

/**
 * The plan: ids and numbers, nothing a guest wrote. Anything else, or any other key, is refused
 * at both ends, so a plan can never smuggle text into the table or out of it.
 */
export const bookPlanSchema: z.ZodType<BookPlan, unknown> = z
  .object({
    chapters: z.array(
      z.strictObject({
        index: count,
        startMs: z.number().int(),
        endMs: z.number().int(),
        photoCount: count,
        title: z.strictObject({
          weekday: z.number().int().min(0).max(6).nullable(),
          moment: z.enum(['morning', 'afternoon', 'evening', 'night']),
          continued: z.boolean(),
        }),
        firstPage: z.number().int().min(1),
      }),
    ),
    pages: z.array(
      z.strictObject({
        template: z.enum(TEMPLATE_IDS),
        slots: z.array(z.strictObject({ photoId: id.transform(asPhotoId) })),
        messageIds: z.array(id.transform(asGuestbookEntryId)).optional(),
        chapter: count.optional(),
      }),
    ),
    selectedCount: count,
    counts: z.strictObject({
      photos: count,
      photographers: count,
      hearts: count,
      messages: count,
      voices: count,
      videos: count,
    }),
    includedMessages: count,
    extraMessages: count,
    hearts: z.record(id, count),
    photographers: z.array(z.strictObject({ guestId: id.transform(asGuestId), photoCount: count })),
    favouritesPage: z.number().int().min(1).nullable(),
    guestbookPage: z.number().int().min(1).nullable(),
  })
  .strict()
