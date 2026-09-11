import type { Event } from '../../../domain/events/event'
import type { Photo } from '../../../domain/photos/photo'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { kenBurnsDurationMs } from '../../../domain/slideshow/kenBurns'
import { buildPlaylist, type Playlist } from '../../../domain/slideshow/playlist'
import { SlideInterval } from '../../../domain/slideshow/slideInterval'
import {
  wallLayoutSpec,
  type WallLayout,
  type WallLayoutSpec,
} from '../../../domain/slideshow/wallLayout'
import { DomainError } from '../../../domain/shared/errors'
import type { GuestId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Slug } from '../../../domain/shared/slug'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { PhotoRepository } from '../../ports/photoRepository'

/**
 * What the projector shows. Public: there is no principal at a projector, and asking
 * one to sign in is asking the host to type a password on a machine in a corner of a
 * reception at 22:00.
 *
 * The read path is structurally incapable of returning a photo that has had no
 * decision. `WALL_STATUSES` is a module constant, not a parameter, so no caller —
 * present or future, honest or not — can widen the wall's query. That is the product's
 * core promise: nothing appears in front of two hundred people without a host saying
 * so, and in 1.0 it was a `WHERE status = 'accepted'` string repeated per handler.
 */

/** The whole read model of the wall. Not a parameter, and never will be. */
const WALL_STATUSES: readonly PhotoStatus[] = ['published']

/**
 * How many photos stay in rotation by default. An eight-hour reception sends thousands;
 * the tail of an uncapped list would not come round again before the lights go up, and
 * the projector re-reads the whole list on every change.
 */
const DEFAULT_WINDOW_SIZE = 200

/**
 * The ceiling on the read itself, independent of the window a caller asks for. It is a
 * public endpoint, so the query it can provoke has to be bounded here rather than by
 * whatever the client typed.
 */
const MAX_CANDIDATES = 500

/** Letterboxed on black, one photo at a time: nobody's head is cropped by default. */
const DEFAULT_LAYOUT: WallLayout = 'spotlight'

/**
 * A live wall puts the newest photo first, so a guest looks up within a slide or two of
 * uploading. The chronological replay is an end-of-evening mode, not this read.
 */
const FRESH_FIRST = true

export interface GetWallPlaylistInput {
  readonly slug: Slug
  /** The projector's own settings. `null` on each takes the default. */
  readonly layout: WallLayout | null
  readonly slideIntervalMs: number | null
  readonly windowSize: number | null
}

export interface GetWallPlaylistDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly guests: GuestRepository
}

export interface WallPlaylistView {
  readonly event: Event
  readonly playlist: Playlist
  /** The published photos behind `playlist.items`, so the caller needs no second read. */
  readonly photos: readonly Photo[]
  /**
   * Who to credit, by photo id — the guest's own display name, resolved here so that no
   * controller has to read a repository to present a slide.
   *
   * A photo is **absent** when there is nobody to name: its sender stayed anonymous, the
   * host uploaded it from the venue's own camera, or the guest row is gone. The wall then
   * shows no credit rather than a fallback, because the fallback ("Invité") is French UI
   * copy and belongs in `web/src/lib/i18n/` — the same decision `Guest.label()` already
   * makes, and the reason this map holds no nulls.
   *
   * Names are resolved for the playlist window only. Reading the whole candidate list
   * would credit slides the room will never see.
   */
  readonly authorNames: ReadonlyMap<PhotoId, string>
  readonly slideIntervalMs: number
  /**
   * Derived from the interval, never configured beside it. 1.0 shipped a 20s zoom
   * against a 10s slide and every image visibly snapped back to its start scale.
   */
  readonly kenBurnsDurationMs: number
  readonly layout: WallLayout
  readonly layoutSpec: WallLayoutSpec
}

export type GetWallPlaylist = (
  input: GetWallPlaylistInput,
) => Promise<Result<WallPlaylistView, DomainError>>

/**
 * The credit under each slide, resolved in **one** repository read.
 *
 * A playlist is many photos by few guests, so the shape that matters is batch-then-join:
 * collect the distinct senders of the photos actually on the wall, ask once, and map the
 * answer back onto photo ids. A `findById` inside the loop would be an N+1 on the one
 * surface that has to stay smooth for eight hours — and it is the wall, so the read is
 * scoped by `eventId` before anything else.
 *
 * Host-uploaded photos never enter the lookup: there is no guest behind them, and the
 * venue's own camera roll is not attributed to anyone on the screen.
 */
const resolveAuthorNames = async (
  guests: GuestRepository,
  eventId: Event['id'],
  onWall: readonly Photo[],
): Promise<ReadonlyMap<PhotoId, string>> => {
  const senders = new Map<PhotoId, GuestId>()
  for (const photo of onWall) {
    if (photo.author.kind === 'guest') senders.set(photo.id, photo.author.guestId)
  }

  const names = await guests.findNamesByIds(eventId, [...new Set(senders.values())])

  const byPhoto = new Map<PhotoId, string>()
  for (const [photoId, guestId] of senders) {
    const name = names.get(guestId)
    // Absent means "nobody to name" — anonymous, unknown, or another event's row. The
    // slide simply carries no credit; see `WallPlaylistView.authorNames`.
    if (name !== undefined) byPhoto.set(photoId, name)
  }

  return byPhoto
}

export const makeGetWallPlaylist =
  ({ events, photos, guests }: GetWallPlaylistDeps): GetWallPlaylist =>
  async ({ slug, layout, slideIntervalMs, windowSize }) => {
    const event = await events.findBySlug(slug)
    // An event that does not serve its wall is answered exactly as one that does not
    // exist: a distinguishable "not open yet" would let anyone enumerate which slugs
    // are real. A `closed` event still serves — the projector is usually still on while
    // people say goodbye.
    if (event === null || !event.servesWall()) {
      return err(DomainError.notFound('event.notFound'))
    }

    const page = await photos.list(event.id, { statuses: WALL_STATUSES, limit: MAX_CANDIDATES })
    const candidates = page.items.map((photo) => ({ id: photo.id, createdAt: photo.createdAt }))

    const playlist = buildPlaylist(candidates, {
      windowSize: windowSize ?? DEFAULT_WINDOW_SIZE,
      freshFirst: FRESH_FIRST,
    })
    if (!playlist.ok) return playlist

    const interval =
      slideIntervalMs === null ? ok(SlideInterval.default()) : SlideInterval.create(slideIntervalMs)
    if (!interval.ok) return interval

    const chosenLayout = layout ?? DEFAULT_LAYOUT

    // Last, and only once the request is known to be answerable: a refused interval or
    // an impossible window must not have cost a second query first.
    const inPlaylist = new Set<PhotoId>(playlist.value.items)
    const authorNames = await resolveAuthorNames(
      guests,
      event.id,
      page.items.filter((photo) => inPlaylist.has(photo.id)),
    )

    return ok({
      event,
      playlist: playlist.value,
      photos: page.items,
      authorNames,
      slideIntervalMs: interval.value.ms,
      kenBurnsDurationMs: kenBurnsDurationMs(interval.value),
      layout: chosenLayout,
      layoutSpec: wallLayoutSpec(chosenLayout),
    })
  }
