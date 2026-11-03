import type { Event } from '../../../domain/events/event'
import type { WallQrPlacement } from '../../../domain/events/wallJoinCard'
import type { Mission } from '../../../domain/missions/mission'
import { isAchieved, type MissionProgress } from '../../../domain/missions/missionProgress'
import type { Photo } from '../../../domain/photos/photo'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { firstStillsOfGuests } from '../../../domain/slideshow/firstPhotos'
import { kenBurnsDurationMs } from '../../../domain/slideshow/kenBurns'
import { buildPlaylist, type Playlist } from '../../../domain/slideshow/playlist'
import { SlideInterval } from '../../../domain/slideshow/slideInterval'
import {
  wallLayoutSpec,
  type WallLayout,
  type WallLayoutSpec,
} from '../../../domain/slideshow/wallLayout'
import {
  GUESTBOOK_WALL_EVERY_NTH,
  GUESTBOOK_WALL_MAX_MESSAGES,
  messageDisplayMs,
} from '../../../domain/guestbook/guestbookWall'
import { wallNeedsSouvenirCount } from '../../../domain/events/eventWallSettings'
import { DomainError } from '../../../domain/shared/errors'
import type { GuestId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Slug } from '../../../domain/shared/slug'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { MissionRepository } from '../../ports/missionRepository'
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

/** A book holds 500 messages at most (the event ceiling), so this reads it whole. */
const MAX_BOOK_ROWS = 500

/** Letterboxed on black, one photo at a time: nobody's head is cropped by default. */
const DEFAULT_LAYOUT: WallLayout = 'spotlight'

/**
 * A live wall puts the newest photo first, so a guest looks up within a slide or two of
 * uploading. The chronological replay is an end-of-evening mode, not this read.
 */
const FRESH_FIRST = true

export interface GetWallPlaylistInput {
  readonly slug: Slug
  /**
   * The projector's own settings. `null` on each takes the event's choice (spec 13), and the
   * default where the event made none.
   */
  readonly layout: WallLayout | null
  readonly slideIntervalMs: number | null
  readonly windowSize: number | null
}

export interface GetWallPlaylistDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly guests: GuestRepository
  readonly missions: MissionRepository
  readonly guestbook: GuestbookRepository
}

/**
 * One prompt as the room sees it (roadmap §2.1).
 *
 * `achieved` is computed here rather than left to the presenter because it is a domain
 * rule, and it is the same rule for both scopes — see `isAchieved`. What differs between
 * a per-guest prompt and a once-for-the-evening one is what the wall *draws*: a tick for
 * the second, a count of guests for the first, which is `progress.completedByGuests` and
 * is why that number is on the wire at all.
 *
 * There is deliberately nothing here about *when* a mission was answered, and therefore
 * nothing a wall could use to celebrate a completion for a few seconds and then stop.
 * That was considered and declined: on an evening with two hundred guests a burst per
 * completion is between one and several hundred bursts on the one surface §11.3 gives a
 * measured frame budget, and §11.2's finding was that motion carries meaning only where
 * it is rare. The room sees the standing list instead — legible at any moment from ten
 * metres, rather than only to whoever happened to be looking three seconds ago.
 */
export interface WallMissionStanding {
  readonly mission: Mission
  readonly progress: MissionProgress
  readonly achieved: boolean
}

/** One guestbook message as the wall shows it: no guest id, only the name the guest gave. */
export interface WallGuestbookMessage {
  readonly id: string
  readonly text: string
  /** `null` for a guest who gave no name or whose row is gone: the client words that. */
  readonly authorName: string | null
  readonly displayMs: number
}

/** What the wall carries of the guestbook; absent when the room is not to show it. */
export interface WallGuestbook {
  readonly everyNth: number
  readonly messages: readonly WallGuestbookMessage[]
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
  /**
   * The photos of the playlist that are the first photograph their named sender has on the
   * wall ("Première photo de Julie"). See `firstStillsOfGuests` for what "first" means.
   *
   * **Empty when the candidate read was cut short.** The read is capped at
   * {@link MAX_CANDIDATES}, newest first, so on a very big evening a guest's earlier photos
   * may simply not be in it, and their oldest photo *in the list* would be called their first
   * on no evidence. Saying nothing is the only answer that is never false.
   */
  readonly firstFromGuest: ReadonlySet<PhotoId>
  readonly slideIntervalMs: number
  /**
   * Derived from the interval, never configured beside it. 1.0 shipped a 20s zoom
   * against a 10s slide and every image visibly snapped back to its start scale.
   */
  readonly kenBurnsDurationMs: number
  readonly layout: WallLayout
  /** Whether the host chose a layout for the event (spec 13); `layout` is the default otherwise. */
  readonly layoutChosen: boolean
  /** The invitation card's settings, as the host chose them (spec 14). */
  readonly joinCard: {
    readonly visible: boolean
    readonly scale: number
    readonly placement: WallQrPlacement
  }
  readonly layoutSpec: WallLayoutSpec
  /**
   * The host's prompts and how the room is answering them. Empty for the overwhelming
   * majority of events, which set none — and an empty list is what stops the wall
   * drawing a panel at all.
   */
  readonly missions: readonly WallMissionStanding[]
  /**
   * How many photographs and clips are visible on the wall (status `published`, operator take-downs
   * left out; guestbook messages and clips still being transcoded are not souvenirs). The server's
   * total, never the window's length: the window is capped at 200. `null` when no wall switch needs
   * it, so that the query is not paid for (spec 11).
   */
  readonly souvenirCount: number | null
  /** The two host switches of spec 11, so the wall needs no second read of the settings. */
  readonly souvenirCounter: boolean
  readonly newPhotoSignal: boolean
  /** `null` unless the guestbook is open and its messages are for the wall, or there is none yet. */
  readonly guestbook: WallGuestbook | null
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

/**
 * The published messages the room may show: only when the host switched the guestbook on **and**
 * its messages for the wall (a closed book is not read out loud), the newest 100, oldest
 * first among them. `published` is the only status the wall ever reads; the repository leaves
 * out what the operator took down.
 */
const readGuestbook = async (
  guestbook: GuestbookRepository,
  guests: GuestRepository,
  event: Event,
): Promise<WallGuestbook | null> => {
  if (!event.settings.allowGuestbook || !event.settings.guestbookOnWall) return null

  const published = await guestbook.listByStatuses(event.id, ['published'], MAX_BOOK_ROWS)
  if (published.length === 0) return null

  const shown = published.slice(-GUESTBOOK_WALL_MAX_MESSAGES)
  const names = await guests.findNamesByIds(event.id, [
    ...new Set(shown.map((entry) => entry.guestId)),
  ])

  return {
    everyNth: GUESTBOOK_WALL_EVERY_NTH,
    messages: shown.map((entry) => ({
      id: entry.id,
      text: entry.text.value,
      authorName: names.get(entry.guestId) ?? null,
      displayMs: messageDisplayMs(entry.text.length),
    })),
  }
}

export const makeGetWallPlaylist =
  ({ events, photos, guests, missions, guestbook }: GetWallPlaylistDeps): GetWallPlaylist =>
  async ({ slug, layout, slideIntervalMs, windowSize }) => {
    const event = await events.findBySlug(slug)
    // An event that does not serve its wall is answered exactly as one that does not
    // exist: a distinguishable "not open yet" would let anyone enumerate which slugs
    // are real. A `closed` event still serves — the projector is usually still on while
    // people say goodbye.
    // A suspended client's wall is the same answer as an event that does not exist (G2-14).
    // `servesPublicWall` is the one definition the middleware and the stream's beat ask as well.
    if (event === null || !event.servesPublicWall()) {
      return err(DomainError.notFound('event.notFound'))
    }

    const page = await photos.list(event.id, { statuses: WALL_STATUSES, limit: MAX_CANDIDATES })
    const candidates = page.items.map((photo) => ({ id: photo.id, createdAt: photo.createdAt }))

    const playlist = buildPlaylist(candidates, {
      windowSize: windowSize ?? DEFAULT_WINDOW_SIZE,
      freshFirst: FRESH_FIRST,
    })
    if (!playlist.ok) return playlist

    const wantedMs = slideIntervalMs ?? event.settings.wall.slideIntervalMs
    const interval =
      wantedMs === null ? ok(SlideInterval.default()) : SlideInterval.create(wantedMs)
    if (!interval.ok) return interval

    const eventLayout = event.settings.wall.layout
    const chosenLayout = layout ?? eventLayout ?? DEFAULT_LAYOUT

    // Last, and only once the request is known to be answerable: a refused interval or
    // an impossible window must not have cost a second query first.
    const inPlaylist = new Set<PhotoId>(playlist.value.items)
    const authorNames = await resolveAuthorNames(
      guests,
      event.id,
      page.items.filter((photo) => inPlaylist.has(photo.id)),
    )

    // A moment for the guest and a cue for their table, so only for a sender the room can
    // name — an anonymous photograph gets no line — and only on a complete read.
    const firstFromGuest =
      page.nextCursor !== null
        ? new Set<PhotoId>()
        : new Set(
            [
              ...firstStillsOfGuests(
                page.items.map((photo) => ({
                  id: photo.id,
                  guestId: photo.author.kind === 'guest' ? photo.author.guestId : null,
                  createdAt: photo.createdAt,
                  kind: photo.facet.kind,
                })),
              ),
            ].filter((id) => authorNames.has(id)),
          )

    // Beside the credits and for the same reason: only once the request is known to be
    // answerable. The whole list, with its counts, in one read — the wall re-reads this
    // response on every signal for eight hours, so a query per prompt would be a query
    // per prompt per guest who joins.
    const standings = await missions.listWithProgress(event.id)

    const book = await readGuestbook(guestbook, guests, event)

    // The same definition as the moderation counters and the album: published, not taken down.
    const wallSettings = event.settings.wall
    const souvenirCount = wallNeedsSouvenirCount(wallSettings)
      ? (await photos.countsByStatus(event.id)).published
      : null

    return ok({
      event,
      playlist: playlist.value,
      photos: page.items,
      authorNames,
      firstFromGuest,
      slideIntervalMs: interval.value.ms,
      kenBurnsDurationMs: kenBurnsDurationMs(interval.value),
      layout: chosenLayout,
      layoutChosen: eventLayout !== null,
      joinCard: {
        visible: event.settings.wall.qrVisible,
        scale: event.settings.wall.qrScale,
        placement: event.settings.wall.qrPlacement,
      },
      layoutSpec: wallLayoutSpec(chosenLayout),
      missions: standings.map((row) => ({ ...row, achieved: isAchieved(row.progress) })),
      guestbook: book,
      souvenirCount,
      souvenirCounter: wallSettings.souvenirCounter,
      newPhotoSignal: wallSettings.newPhotoSignal,
    })
  }
