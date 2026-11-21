import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import { ContentHash } from '../../../domain/photos/contentHash'
import { EVENT_LOGO } from '../../../domain/photos/mediaVariant'
import { aGuestInvite, anEvent } from '../../testing/builders'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import {
  CLOSED,
  DRAFT,
  guestInviteScene,
  WEDDING,
  type GuestInviteScene,
} from '../../testing/guestInviteScene'
import {
  makeGetGuestInviteLogoMedia,
  type GetGuestInviteLogoMedia,
} from './getGuestInviteLogoMedia'

const LOGO = (() => {
  const made = ContentHash.create('a1'.padEnd(64, '0'))
  if (!made.ok) throw new Error('digest')
  return made.value
})()
const TOKEN = '7777777777777777'

describe('getGuestInviteLogoMedia (spec 29)', () => {
  let scene: GuestInviteScene
  let media: InMemoryMediaStore
  let getLogo: GetGuestInviteLogoMedia

  const withLogo = (id: typeof WEDDING): void => {
    const event = anEvent({ id })
    scene.events.seed(
      Event.restore({
        ...event.toProps(),
        ...(id === WEDDING ? { slug: event.slug, joinCode: event.joinCode } : {}),
        settings: event.settings.withLogo(LOGO),
      }),
    )
  }
  const publish = (id: typeof WEDDING, extra: Parameters<typeof aGuestInvite>[0] = {}): void => {
    scene.invites.seed(
      aGuestInvite({
        eventId: id,
        tokenByte: 7,
        enabled: true,
        startsAt: '2026-12-13T18:00:00Z',
        timeZone: 'Europe/Paris',
        ...extra,
      }),
    )
  }
  const refusal = async (token: unknown = TOKEN): Promise<string> => {
    const got = await getLogo({ token })
    return got.ok ? 'served' : `${got.error.kind} ${got.error.code}`
  }

  beforeEach(async () => {
    scene = await guestInviteScene()
    media = new InMemoryMediaStore()
    getLogo = makeGetGuestInviteLogoMedia({
      events: scene.events,
      invites: scene.invites,
      media,
    })
    await media.put(WEDDING, LOGO, EVENT_LOGO, Uint8Array.of(7, 8, 9))
    await media.put(DRAFT, LOGO, EVENT_LOGO, Uint8Array.of(7, 8, 9))
    await media.put(CLOSED, LOGO, EVENT_LOGO, Uint8Array.of(7, 8, 9))
  })

  it('serves the logo of an event while its invitation page is served, a draft included', async () => {
    for (const id of [WEDDING, DRAFT, CLOSED]) {
      const fresh = await guestInviteScene()
      scene = fresh
      getLogo = makeGetGuestInviteLogoMedia({
        events: fresh.events,
        invites: fresh.invites,
        media,
      })
      const event = (await fresh.events.findById(id))!
      fresh.events.seed(
        Event.restore({ ...event.toProps(), settings: event.settings.withLogo(LOGO) }),
      )
      publish(id)

      const got = await getLogo({ token: TOKEN })

      expect(got.ok && [got.value.byteSize, got.value.contentType], id).toEqual([3, 'image/webp'])
      const chunks: number[] = []
      for await (const chunk of (got.ok && (await got.value.open())) || []) chunks.push(...chunk)
      expect(chunks).toEqual([7, 8, 9])
    }
  })

  it('is the page’s own refusal for a token that does not open the page', async () => {
    withLogo(WEDDING)
    publish(WEDDING, { enabled: false })

    expect(await refusal()).toBe('notFound guestInvite.notAvailable')
    expect(await refusal('short')).toBe('notFound guestInvite.notAvailable')
    expect(await refusal(null)).toBe('notFound guestInvite.notAvailable')
    expect(await refusal('AAAAAAAAAAAAAAAA')).toBe('notFound guestInvite.notAvailable')
  })

  it('is the same refusal for an archived event and for an invitation whose event is gone', async () => {
    publish('evt-archived' as typeof WEDDING)
    expect(await refusal()).toBe('notFound guestInvite.notAvailable')

    const fresh = await guestInviteScene()
    getLogo = makeGetGuestInviteLogoMedia({ events: fresh.events, invites: fresh.invites, media })
    fresh.invites.seed(aGuestInvite({ eventId: 'evt-vanished', tokenByte: 7, enabled: true }))
    expect(await refusal()).toBe('notFound guestInvite.notAvailable')
  })

  it('is the same refusal for an event with no logo, and for a logo whose bytes are gone', async () => {
    publish(WEDDING)
    expect(await refusal()).toBe('notFound guestInvite.notAvailable')

    withLogo(WEDDING)
    await media.delete(WEDDING, LOGO)
    expect(await refusal()).toBe('notFound guestInvite.notAvailable')
  })
})
