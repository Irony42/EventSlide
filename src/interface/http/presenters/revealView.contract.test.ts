import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeListGuestPhotos } from '../../../application/usecases/photos/listGuestPhotos'
import { makeGetWallPlaylist } from '../../../application/usecases/slideshow/getWallPlaylist'
import { makeListGalleryPhotos } from '../../../application/usecases/gallery/listGalleryPhotos'
import { makeOpenGallery } from '../../../application/usecases/gallery/openGallery'
import { AT, anEvent } from '../../../application/testing/builders'
import { FakeAnnouncementRepository } from '../../../application/testing/fakeAnnouncementRepository'
import { FakeChallengeRepository } from '../../../application/testing/fakeChallengeRepository'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../../application/testing/fakeGuestbookRepository'
import { FakeGuestRepository } from '../../../application/testing/fakeGuestRepository'
import { FakeMissionRepository } from '../../../application/testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import {
  buildGalleryWorld,
  OWNER,
  WEDDING,
  WEDDING_SLUG,
} from '../../../application/testing/galleryWorld'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import { revealView, toGalleryDto, toGalleryPageDto, toWallResponseDto } from './presenters'
import type { PresenterContext } from './presenters'

/**
 * **One rule, one shape** (spec 23, §5 "Présentateur unique"): the wall, the guest's phone and
 * the gallery carry the reveal block that `revealView` builds, from the same event and the same
 * instant, so they cannot disagree about whether the evening is shown. Modelled on
 * `wallPhaseContract.test.ts`, which pins a rule two parties must share; here the parties are
 * three responses of one server, and the second half pins that nothing else in the presenters
 * decides the reveal.
 */

const HOUR = 3_600_000
const BLOCK_KEYS = ['atMs', 'enabled', 'film', 'revealed', 'serverNowMs']

const presenter: PresenterContext = {
  publicUrl: 'http://localhost:4300',
  uploadLimits: { maxBytes: 25_000_000, maxFiles: 20 },
  clipLimits: { maxBytes: 80_000_000, maxSeconds: 15, supported: true },
}

/** Every state of the gate, relative to the instant the three surfaces are read at (AT). */
const SCENARIOS: readonly { readonly name: string; readonly settings: EventSettingsPatch }[] = [
  { name: 'the mode off', settings: {} },
  {
    name: 'the mode off with a stored film look',
    settings: { reveal: { enabled: false, film: true } },
  },
  { name: 'waiting for the button', settings: { reveal: { enabled: true, at: null } } },
  {
    name: 'waiting for an hour',
    settings: { reveal: { enabled: true, at: new Date(AT.getTime() + HOUR), film: true } },
  },
  {
    name: 'the exact instant of the hour',
    settings: { reveal: { enabled: true, at: new Date(AT.getTime()), film: true } },
  },
  {
    name: 'an hour that has gone by',
    settings: { reveal: { enabled: true, at: new Date(AT.getTime() - HOUR) } },
  },
]

describe('revealView: the one block of the wall, the phone and the gallery', () => {
  it.each(SCENARIOS)('is the same block on all three surfaces: $name', async ({ settings }) => {
    // The wall.
    const photos = new FakePhotoRepository()
    const events = new FakeEventRepository().seed(
      anEvent({ id: 'event-1', slug: 'camille-et-sacha', settings }),
    )
    const wall = await makeGetWallPlaylist({
      events,
      photos,
      guests: new FakeGuestRepository(),
      missions: new FakeMissionRepository(photos),
      guestbook: new FakeGuestbookRepository(),
      challenges: new FakeChallengeRepository(photos),
      announcements: new FakeAnnouncementRepository(),
      clock: { now: () => new Date(AT.getTime()) },
    })({
      slug: anEvent({ slug: 'camille-et-sacha' }).slug,
      layout: null,
      slideIntervalMs: null,
      windowSize: null,
    })
    if (!wall.ok) throw new Error(wall.error.code)
    const wallBlock = toWallResponseDto(wall.value, presenter).reveal

    // The phone.
    const phone = await makeListGuestPhotos({
      events,
      photos,
      missions: new FakeMissionRepository(photos),
      clock: { now: () => new Date(AT.getTime()) },
    })({ eventId: asEventId('event-1'), guestId: asGuestId('guest-1') })
    if (!phone.ok) throw new Error(phone.error.code)
    const phoneBlock = revealView(phone.value.event, phone.value.now)

    // The gallery, its opening and its grid.
    const world = buildGalleryWorld()
    world.events.seed(
      anEvent({ id: WEDDING, ownerId: OWNER, slug: WEDDING_SLUG, status: 'closed', settings }),
    )
    const { token } = world.seedLink()
    const opened = await makeOpenGallery(world)({ token, unlockProof: null })
    const listed = await makeListGalleryPhotos(world)({ token, unlockProof: null, cursor: null })
    if (!opened.ok || !listed.ok) throw new Error('gallery refused')
    const openBlock = toGalleryDto(opened.value).reveal
    const gridBlock = toGalleryPageDto(listed.value).reveal

    const { readyCount: _ready, ...wallShared } = wallBlock
    expect(phoneBlock).toEqual(wallShared)
    expect(openBlock).toEqual(wallShared)
    expect(gridBlock).toEqual(wallShared)
    expect(Object.keys(phoneBlock).sort()).toEqual(BLOCK_KEYS)
    expect(Object.keys(wallBlock).sort()).toEqual([...BLOCK_KEYS, 'readyCount'].sort())
  })

  it.each([
    ['the mode off', {}, { enabled: false, revealed: true, atMs: null, film: false }],
    [
      'the mode off with a stored film look',
      { reveal: { enabled: false, film: true } },
      { enabled: false, revealed: true, atMs: null, film: false },
    ],
    [
      'waiting for the button',
      { reveal: { enabled: true, at: null } },
      { enabled: true, revealed: false, atMs: null, film: false },
    ],
    [
      'the exact instant of the hour',
      { reveal: { enabled: true, at: new Date(AT.getTime()), film: true } },
      { enabled: true, revealed: true, atMs: AT.getTime(), film: true },
    ],
    [
      'one millisecond before the hour',
      { reveal: { enabled: true, at: new Date(AT.getTime() + 1) } },
      { enabled: true, revealed: false, atMs: AT.getTime() + 1, film: false },
    ],
  ] as const)(
    'builds the block of %s from the event and the server’s instant',
    (_name, settings, expected) => {
      const event = anEvent({ settings: settings as EventSettingsPatch })

      expect(revealView(event, AT)).toEqual({ ...expected, serverNowMs: AT.getTime() })
    },
  )

  it('is the only place the presenters decide that the evening is revealed', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/interface/http/presenters/presenters.ts'),
      'utf8',
    )

    // One call of the domain rule (inside `revealView`): a second spelling in a presenter would be
    // the three surfaces drifting, the thing this contract exists to stop.
    expect(source.match(/\bisRevealed\(/g)).toHaveLength(1)
  })
})
