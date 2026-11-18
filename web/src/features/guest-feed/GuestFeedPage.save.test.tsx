import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestFeedPage } from './GuestFeedPage'
import { readGuestSession, rememberGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { photoAlt } from '../../lib/photoAlt'
import { deferred } from '../../testing/deferred'
import { useFakeDevice, type FakeDevice } from '../../testing/fakeDevice'
import {
  aGuestPhoto,
  aPrivacyNoticeState,
  aPublicEvent,
  aWallClip,
  aWallItem,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { WallItemDto, WallResponse } from '../../lib/api/dto'

/**
 * "Enregistrer" on the feed, the page's half of spec 24: which photographs get a button, and
 * what the page does when a tap learns something about the whole feed. What one button does
 * with the file is `SaveButton.test.tsx`'s.
 */

const SLUG = 'camille-et-sacha'

const havingJoined = (): void => {
  rememberGuestSession({
    event: aPublicEvent(),
    displayName: 'Léa',
    privacyNotice: aPrivacyNoticeState(),
  })
}

const photo = (id: string, overrides: Partial<WallItemDto> = {}): WallItemDto =>
  aWallItem({ id, caption: `Photo ${id}`, authorName: 'Julie', ...overrides })

const feedOf = (
  items: readonly WallItemDto[],
  wall: Partial<WallResponse> = {},
  extra: Partial<Api> = {},
): Api =>
  fakeApi({
    wall: vi.fn(async () => aWallResponse({ items: [...items], ...wall })),
    myPhotos: vi.fn(async () => ({ items: [] })),
    ...extra,
  })

const renderFeed = (api: Api) =>
  renderWithProviders(<GuestFeedPage />, {
    api,
    route: `/e/${SLUG}/photos`,
    path: '/e/:slug/photos',
  })

/** The save buttons on screen, by their visible word (a reaction or "Voir plus" is not one). */
const saveButtons = (): HTMLElement[] =>
  screen.queryAllByRole('button').filter((node) => node.textContent === fr.app.save)

const refusing = (status: number, code: string): Partial<Api> => ({
  savePhoto: vi.fn(async () => {
    throw new ApiError(status, code)
  }),
})

let device: FakeDevice

beforeEach(() => {
  havingJoined()
  device = useFakeDevice({ kind: 'android' })
})

afterEach(() => {
  device.restore()
})

describe('which photographs get a button', () => {
  it('puts one under each photograph of somebody else’s, named after that photograph', async () => {
    renderFeed(feedOf([photo('a'), photo('b')]))

    await screen.findAllByRole('img')

    expect(saveButtons()).toHaveLength(2)
    for (const id of ['a', 'b']) {
      const item = photo(id)
      expect(
        screen.getByRole('button', { name: fr.feed.saveNamed(fr.app.save, photoAlt(item, fr)) }),
      ).toBeVisible()
    }
  })

  it('puts none under the guest’s own photograph, which is already on their phone in better quality', async () => {
    renderFeed(
      feedOf(
        [photo('mine'), photo('theirs')],
        {},
        { myPhotos: vi.fn(async () => ({ items: [aGuestPhoto({ id: 'mine' })] })) },
      ),
    )

    const cards = await screen.findAllByRole('listitem')

    expect(
      within(cards[0]!).queryByRole('button', { name: new RegExp(`^${fr.app.save}`) }),
    ).toBeNull()
    expect(
      within(cards[1]!).getByRole('button', { name: new RegExp(`^${fr.app.save}`) }),
    ).toBeVisible()
  })

  it('puts none under a clip, which is not saved in this version', async () => {
    renderFeed(feedOf([aWallClip({ id: 'clip' }), photo('a')]))

    await screen.findAllByRole('listitem')

    expect(saveButtons()).toHaveLength(1)
  })

  it('puts none anywhere when the host has switched saving off, as the wall says', async () => {
    renderFeed(feedOf([photo('a'), photo('b')], { guestSaveEnabled: false }))

    await screen.findAllByRole('img')

    expect(saveButtons()).toEqual([])
    // Nothing to explain: this evening never offered it.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('draws none before the guest’s own list has answered, rather than a button that comes and goes', async () => {
    const mine = deferred<{ items: [] }>()
    renderFeed(feedOf([photo('a')], {}, { myPhotos: vi.fn(() => mine.promise) }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading))
    expect(saveButtons()).toEqual([])

    mine.resolve({ items: [] })
    await waitFor(() => expect(saveButtons()).toHaveLength(1))
  })
})

describe('a guest whose access has lapsed, on an evening that is open', () => {
  const lapsed = (wall: Partial<WallResponse> = {}): Api =>
    feedOf([photo('a'), photo('b')], wall, {
      myPhotos: vi.fn(async () => {
        throw new ApiError(401, 'guestToken.expired')
      }),
    })

  it('has no button, and one sentence under the title that says how to come back in', async () => {
    renderFeed(lapsed({ acceptsGuests: true }))

    await screen.findAllByRole('img')

    expect(saveButtons()).toEqual([])
    expect(screen.getAllByText(fr.feed.saveExpiredOpen)).toHaveLength(1)
    expect(screen.queryByText(fr.feed.saveExpiredClosed)).toBeNull()
  })

  it('says it is the album’s link to ask for when the evening is over, because the door is shut', async () => {
    renderFeed(lapsed({ acceptsGuests: false }))

    await screen.findAllByRole('img')

    expect(screen.getAllByText(fr.feed.saveExpiredClosed)).toHaveLength(1)
    expect(screen.queryByText(fr.feed.saveExpiredOpen)).toBeNull()
  })

  it('says nothing about it on an evening that never offered saving', async () => {
    renderFeed(lapsed({ guestSaveEnabled: false }))

    await screen.findAllByRole('img')

    expect(screen.queryByText(fr.feed.saveExpiredOpen)).toBeNull()
    expect(screen.queryByText(fr.feed.saveExpiredClosed)).toBeNull()
  })

  it('still lets the guest read the feed', async () => {
    renderFeed(lapsed())

    expect(await screen.findAllByRole('img')).toHaveLength(2)
  })
})

describe('a guest the host has removed', () => {
  it('has no button after a reload, and is told it was the host who removed them', async () => {
    renderFeed(
      feedOf(
        [photo('a')],
        {},
        {
          myPhotos: vi.fn(async () => {
            throw new ApiError(403, 'guest.revoked')
          }),
        },
      ),
    )

    await screen.findAllByRole('img')

    expect(saveButtons()).toEqual([])
    expect(screen.getByText(fr.feed.saveRevoked)).toBeVisible()
  })

  it('has every button taken away at the first tap that finds out', async () => {
    renderFeed(feedOf([photo('a'), photo('b')], {}, refusing(403, 'guest.revoked')))
    await screen.findAllByRole('img')

    await userEvent.click(saveButtons()[0]!)

    await waitFor(() => expect(saveButtons()).toEqual([]))
    expect(screen.getAllByText(fr.feed.saveRevoked)).toHaveLength(1)
  })
})

describe('a cut made while the feed was open', () => {
  it('takes every button away once, with one sentence, not one refusal per tap', async () => {
    // The nominal course of a cut: the feed has no live channel, so the route is the door.
    const api = feedOf([photo('a'), photo('b'), photo('c')], {}, refusing(403, 'save.disabled'))
    renderFeed(api)
    await screen.findAllByRole('img')
    expect(saveButtons()).toHaveLength(3)

    await userEvent.click(saveButtons()[1]!)

    await waitFor(() => expect(saveButtons()).toEqual([]))
    expect(screen.getAllByText(fr.feed.saveDisabled)).toHaveLength(1)
    expect(api.savePhoto).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers the buttons again after "Actualiser" when the wall says saving is on once more', async () => {
    const api = feedOf([photo('a')], {}, refusing(403, 'save.disabled'))
    renderFeed(api)
    await screen.findAllByRole('img')
    await userEvent.click(saveButtons()[0]!)
    await waitFor(() => expect(saveButtons()).toEqual([]))

    await userEvent.click(screen.getByRole('button', { name: fr.feed.refresh }))

    await waitFor(() => expect(saveButtons()).toHaveLength(1))
    expect(screen.queryByText(fr.feed.saveDisabled)).toBeNull()
  })

  it('keeps them off after "Actualiser" when the wall now says saving is off', async () => {
    let reads = 0
    const api = feedOf(
      [photo('a')],
      {},
      {
        ...refusing(403, 'save.disabled'),
        wall: vi.fn(async () => {
          reads += 1
          return aWallResponse({ items: [photo('a')], guestSaveEnabled: reads === 1 })
        }),
      },
    )
    renderFeed(api)
    await screen.findAllByRole('img')
    await userEvent.click(saveButtons()[0]!)
    await waitFor(() => expect(saveButtons()).toEqual([]))

    await userEvent.click(screen.getByRole('button', { name: fr.feed.refresh }))

    await waitFor(() => expect(api.wall).toHaveBeenCalledTimes(2))
    expect(saveButtons()).toEqual([])
  })
})

describe('an access that expires under a tap', () => {
  it('has the page forget the session like a feed that found out on load, and say what to do', async () => {
    renderFeed(feedOf([photo('a')], { acceptsGuests: true }, refusing(401, 'guestToken.expired')))
    await screen.findAllByRole('img')
    expect(readGuestSession(SLUG)).not.toBeNull()

    await userEvent.click(saveButtons()[0]!)

    await waitFor(() => expect(readGuestSession(SLUG)).toBeNull())
    expect(screen.getByText(fr.feed.saveExpiredOpen)).toBeVisible()
    expect(saveButtons()).toEqual([])
  })

  it('says to ask for the album’s link when the evening is over', async () => {
    renderFeed(feedOf([photo('a')], { acceptsGuests: false }, refusing(401, 'guestToken.expired')))
    await screen.findAllByRole('img')

    await userEvent.click(saveButtons()[0]!)

    expect(await screen.findByText(fr.feed.saveExpiredClosed)).toBeVisible()
  })
})

describe('a photograph that vanished under the tap', () => {
  it('says so once, reads the feed again, and lets the card go', async () => {
    let reads = 0
    const api = feedOf(
      [],
      {},
      {
        ...refusing(404, 'photo.notFound'),
        wall: vi.fn(async () => {
          reads += 1
          return aWallResponse({ items: reads === 1 ? [photo('a'), photo('b')] : [photo('b')] })
        }),
      },
    )
    renderFeed(api)
    await screen.findAllByRole('img')

    await userEvent.click(saveButtons()[0]!)

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1))
    expect(api.wall).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText(fr.feed.saveGone)).toHaveLength(1)
  })

  it('leaves the other buttons as they were', async () => {
    renderFeed(feedOf([photo('a'), photo('b')], {}, refusing(404, 'photo.notFound')))
    await screen.findAllByRole('img')

    await userEvent.click(saveButtons()[0]!)

    await screen.findAllByText(fr.feed.saveGone)
    expect(saveButtons().length).toBeGreaterThanOrEqual(1)
  })
})

describe('an evening that is not served any more', () => {
  it('reads the feed again, which says it once in its own words', async () => {
    let reads = 0
    const api = feedOf(
      [],
      {},
      {
        ...refusing(404, 'event.notFound'),
        wall: vi.fn(async () => {
          reads += 1
          if (reads > 1) throw new ApiError(404, 'event.notFound')
          return aWallResponse({ items: [photo('a')] })
        }),
      },
    )
    renderFeed(api)
    await screen.findAllByRole('img')

    await userEvent.click(saveButtons()[0]!)

    expect(await screen.findByRole('heading', { name: fr.feed.unavailable })).toBeVisible()
    expect(saveButtons()).toEqual([])
  })
})

describe('the help line', () => {
  beforeEach(() => {
    device.restore()
    device = useFakeDevice({ kind: 'iphone' })
  })

  it('is said on the first tap of the device, and not again under the next photograph', async () => {
    renderFeed(feedOf([photo('a'), photo('b')]))
    await screen.findAllByRole('img')

    await userEvent.click(saveButtons()[0]!)
    expect(await screen.findByText(fr.feed.saveHelpSheet)).toBeVisible()
    await waitFor(() => expect(device.share).toHaveBeenCalledTimes(1))

    await userEvent.click(saveButtons()[1]!)
    await waitFor(() => expect(device.share).toHaveBeenCalledTimes(2))

    expect(screen.getAllByText(fr.feed.saveHelpSheet)).toHaveLength(1)
  })

  it('is not said at all to a device that has been told already', async () => {
    localStorage.setItem('eventslide.saveHelpShown', '1')
    renderFeed(feedOf([photo('a')]))
    await screen.findAllByRole('img')

    await userEvent.click(saveButtons()[0]!)

    await waitFor(() => expect(device.share).toHaveBeenCalled())
    expect(screen.queryByText(fr.feed.saveHelpSheet)).toBeNull()
  })

  it('is remembered by the device, so a later visit does not say it again', async () => {
    const first = renderFeed(feedOf([photo('a')]))
    await screen.findAllByRole('img')
    await userEvent.click(saveButtons()[0]!)
    await screen.findByText(fr.feed.saveHelpSheet)
    first.unmount()

    renderFeed(feedOf([photo('a')]))
    await screen.findAllByRole('img')
    await userEvent.click(saveButtons()[0]!)

    await waitFor(() => expect(device.share).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(fr.feed.saveHelpSheet)).toBeNull()
  })

  it('works on a device that will not store anything, and says itself once per visit', async () => {
    // A private window, or blocked site data: the page must not break, and must not nag.
    const realGet = Storage.prototype.getItem
    const realSet = Storage.prototype.setItem
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key === 'eventslide.saveHelpShown') throw new DOMException('blocked', 'SecurityError')
      return realGet.call(this, key)
    })
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'eventslide.saveHelpShown')
        throw new DOMException('blocked', 'QuotaExceededError')
      realSet.call(this, key, value)
    })
    try {
      renderFeed(feedOf([photo('a'), photo('b')]))
      await screen.findAllByRole('img')

      await userEvent.click(saveButtons()[0]!)
      expect(await screen.findByText(fr.feed.saveHelpSheet)).toBeVisible()
      await userEvent.click(saveButtons()[1]!)
      await waitFor(() => expect(device.share).toHaveBeenCalledTimes(2))

      expect(screen.getAllByText(fr.feed.saveHelpSheet)).toHaveLength(1)
    } finally {
      read.mockRestore()
      write.mockRestore()
    }
  })
})

describe('what the feed announces', () => {
  it('announces nothing on its own once it has loaded: no alert, and no status for the buttons', async () => {
    renderFeed(feedOf([photo('a'), photo('b')]))

    await screen.findAllByRole('img')

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
