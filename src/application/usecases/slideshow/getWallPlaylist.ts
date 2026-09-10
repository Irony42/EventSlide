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
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Slug } from '../../../domain/shared/slug'
import type { EventRepository } from '../../ports/eventRepository'
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
}

export interface WallPlaylistView {
  readonly event: Event
  readonly playlist: Playlist
  /** The published photos behind `playlist.items`, so the caller needs no second read. */
  readonly photos: readonly Photo[]
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

export const makeGetWallPlaylist =
  ({ events, photos }: GetWallPlaylistDeps): GetWallPlaylist =>
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

    return ok({
      event,
      playlist: playlist.value,
      photos: page.items,
      slideIntervalMs: interval.value.ms,
      kenBurnsDurationMs: kenBurnsDurationMs(interval.value),
      layout: chosenLayout,
      layoutSpec: wallLayoutSpec(chosenLayout),
    })
  }
