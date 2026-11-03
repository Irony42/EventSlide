import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetWallPlaylist, type GetWallPlaylist } from './getWallPlaylist'
import {
  GUESTBOOK_WALL_EVERY_NTH,
  GUESTBOOK_WALL_MAX_MESSAGES,
  messageDisplayMs,
} from '../../../domain/guestbook/guestbookWall'
import { aGuest, aGuestbookEntry, anEvent, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'

/** The guestbook half of the wall's playlist (spec 01): what the room may read, and nothing else. */
describe('getWallPlaylist — the guestbook', () => {
  let events: FakeEventRepository
  let guests: FakeGuestRepository
  let guestbook: FakeGuestbookRepository
  let getWallPlaylist: GetWallPlaylist

  beforeEach(() => {
    events = new FakeEventRepository()
    guests = new FakeGuestRepository()
    guestbook = new FakeGuestbookRepository()
    const photos = new FakePhotoRepository()
    getWallPlaylist = makeGetWallPlaylist({
      clock: new FakeClock(),
      events,
      photos,
      guests,
      missions: new FakeMissionRepository(photos),
      guestbook,
    })
    guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Léa' }))
  })

  const open = (settings: EventSettingsPatch = { allowGuestbook: true, guestbookOnWall: true }) =>
    events.seed(anEvent({ id: 'event-1', slug: 'camille-et-sacha', status: 'live', settings }))

  const book = async () => {
    const result = await getWallPlaylist({
      slug: anEvent({ slug: 'camille-et-sacha' }).slug,
      layout: null,
      slideIntervalMs: null,
      windowSize: null,
    })
    if (!result.ok) throw new Error('wall refused')
    return result.value.guestbook
  }

  it('carries nothing when no message is published', async () => {
    open()
    guestbook.seed(aGuestbookEntry({ id: 'e-pending', moderation: 'manual' }))

    expect(await book()).toBeNull()
  })

  it('carries only published messages, signed by the guest’s name, with the server’s rhythm', async () => {
    open()
    guestbook.seed(
      aGuestbookEntry({ id: 'e-pending', text: 'en attente', moderation: 'manual' }),
      aGuestbookEntry({ id: 'e-shown', text: 'Bravo', moderation: 'auto' }),
    )

    expect(await book()).toEqual({
      everyNth: GUESTBOOK_WALL_EVERY_NTH,
      messages: [
        { id: 'e-shown', text: 'Bravo', authorName: 'Léa', displayMs: messageDisplayMs(5) },
      ],
    })
  })

  it('leaves the signature empty for a guest who gave no name or whose row is gone', async () => {
    open()
    guestbook.seed(aGuestbookEntry({ id: 'e-gone', guestId: 'guest-gone', moderation: 'auto' }))

    expect((await book())?.messages[0]?.authorName).toBeNull()
  })

  it('carries nothing when the host did not want the messages on the wall', async () => {
    open({ allowGuestbook: true, guestbookOnWall: false })
    guestbook.seed(aGuestbookEntry({ moderation: 'auto' }))

    expect(await book()).toBeNull()
  })

  it('carries nothing once the host closed the guestbook', async () => {
    open({ allowGuestbook: false, guestbookOnWall: true })
    guestbook.seed(aGuestbookEntry({ moderation: 'auto' }))

    expect(await book()).toBeNull()
  })

  it('does not carry a message of another event', async () => {
    open()
    guestbook.seed(aGuestbookEntry({ eventId: 'event-2', moderation: 'auto' }))

    expect(await book()).toBeNull()
  })

  it('keeps the newest hundred, oldest first among them', async () => {
    open()
    const total = GUESTBOOK_WALL_MAX_MESSAGES + 2
    guestbook.seed(
      ...Array.from({ length: total }, (_, index) =>
        aGuestbookEntry({ id: `e-${index}`, moderation: 'auto', createdAt: atPlus(index * 1000) }),
      ),
    )

    const messages = (await book())?.messages ?? []

    expect(messages).toHaveLength(GUESTBOOK_WALL_MAX_MESSAGES)
    expect(messages[0]?.id).toBe('e-2')
    expect(messages.at(-1)?.id).toBe(`e-${total - 1}`)
  })
})
