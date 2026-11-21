import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import { ContentHash } from '../../../domain/photos/contentHash'
import { DEFAULT_EVENT_THEME } from '../../../domain/events/eventTheme'
import { JoinCode } from '../../../domain/shared/joinCode'
import { aGuestInvite, anEvent } from '../../testing/builders'
import {
  CLOSED,
  DRAFT,
  FROZEN,
  WEDDING,
  guestInviteScene,
  type GuestInviteScene,
} from '../../testing/guestInviteScene'

describe('viewGuestInvite (spec 29)', () => {
  let scene: GuestInviteScene

  const publish = (
    eventId: typeof WEDDING,
    extra: Parameters<typeof aGuestInvite>[0] = {},
  ): void => {
    scene.invites.seed(
      aGuestInvite({
        eventId,
        tokenByte: 7,
        enabled: true,
        title: 'Léa fête ses 40 ans',
        startsAt: '2026-12-13T18:00:00Z',
        endsAt: '2026-12-14T02:00:00Z',
        timeZone: 'Europe/Paris',
        venueName: 'Salle des fêtes',
        address: '1 rue de la Gare',
        message: 'Venez comme vous êtes.',
        language: 'it',
        ...extra,
      }),
    )
  }
  const tokenOfSeven = '7777777777777777'
  const view = (token: unknown = tokenOfSeven) => scene.view({ token })

  beforeEach(async () => {
    scene = await guestInviteScene()
  })

  it('shows an upcoming party its details and no join code', async () => {
    publish(DRAFT)

    const seen = await view()

    expect(seen.ok && seen.value).toMatchObject({
      state: 'upcoming',
      title: 'Léa fête ses 40 ans',
      venueName: 'Salle des fêtes',
      address: '1 rue de la Gare',
      message: 'Venez comme vous êtes.',
      language: 'it',
      hasLogo: false,
    })
    expect(seen.ok && seen.value.schedule).toEqual({
      startsAt: new Date('2026-12-13T18:00:00Z'),
      endsAt: new Date('2026-12-14T02:00:00Z'),
      timeZone: 'Europe/Paris',
    })
    expect(seen.ok && 'joinCode' in seen.value).toBe(false)
  })

  it('hands the current join code over only while the evening is on', async () => {
    publish(WEDDING)

    const seen = await view()

    expect(seen.ok && seen.value.state).toBe('joinable')
    expect(seen.ok && seen.value.joinCode).toBe('H7K2QM')
  })

  it('follows a rotation of the join code the next time the page is read', async () => {
    publish(WEDDING)
    const event = await scene.events.findById(WEDDING)
    const code = JoinCode.create('Z9Z9Z9')
    if (event === null || !code.ok) throw new Error('setup')
    const rotated = event.rotateJoinCode(code.value)
    if (!rotated.ok) throw new Error('rotate')
    await scene.events.save(rotated.value)

    const seen = await view()

    expect(seen.ok && seen.value.joinCode).toBe('Z9Z9Z9')
  })

  it('serves a closed event’s title, date and place, and neither the address nor the word', async () => {
    publish(CLOSED)

    const seen = await view()

    expect(seen.ok && seen.value.state).toBe('over')
    expect(seen.ok && seen.value.title).toBe('Léa fête ses 40 ans')
    expect(seen.ok && seen.value.venueName).toBe('Salle des fêtes')
    expect(seen.ok && 'address' in seen.value).toBe(false)
    expect(seen.ok && 'message' in seen.value).toBe(false)
    expect(seen.ok && 'joinCode' in seen.value).toBe(false)
    expect(JSON.stringify(seen)).not.toContain('rue de la Gare')
    expect(JSON.stringify(seen)).not.toContain('comme vous êtes')
  })

  it('falls back to the event’s name when the host wrote no title', async () => {
    publish(WEDDING, { title: null })

    const seen = await view()

    expect(seen.ok && seen.value.title).toBe('Camille & Sacha')
  })

  it('hands over the event’s accent hue and nothing else of its look', async () => {
    scene.events.seed(
      anEvent({
        id: 'evt-rose',
        slug: 'rose',
        joinCode: 'F8R5TV',
        settings: { theme: { ...DEFAULT_EVENT_THEME, accentHue: 345, ambiance: 'guinguette' } },
      }),
    )
    publish('evt-rose' as typeof WEDDING)

    const seen = await view()

    expect(seen.ok && seen.value.accentHue).toBe(345)
    expect(JSON.stringify(seen)).not.toContain('guinguette')
  })

  it('says the product’s own hue for an event nobody themed', async () => {
    publish(WEDDING)

    const seen = await view()

    expect(seen.ok && seen.value.accentHue).toBe(DEFAULT_EVENT_THEME.accentHue)
  })

  it('says whether the event has a logo', async () => {
    const hash = ContentHash.create('a'.repeat(64))
    if (!hash.ok) throw new Error('hash')
    const withLogo = anEvent({ id: 'evt-logo', slug: 'logo', joinCode: 'F8R5TV' })
    scene.events.seed(
      Event.restore({
        ...withLogo.toProps(),
        settings: withLogo.settings.withLogo(hash.value),
      }),
    )
    publish('evt-logo' as typeof WEDDING)

    const seen = await view()

    expect(seen.ok && seen.value.hasLogo).toBe(true)
  })

  describe('one refusal for everything that is not a page', () => {
    const refusal = async (token: unknown = tokenOfSeven) => {
      const seen = await scene.view({ token })
      return seen.ok ? 'served' : `${seen.error.kind} ${seen.error.code}`
    }
    const NOT_AVAILABLE = 'notFound guestInvite.notAvailable'

    it('is the same for an unknown token and a malformed one', async () => {
      publish(WEDDING)

      expect(await refusal('AAAAAAAAAAAAAAAA')).toBe(NOT_AVAILABLE)
      expect(await refusal('short')).toBe(NOT_AVAILABLE)
      expect(await refusal(null)).toBe(NOT_AVAILABLE)
      expect(await refusal(42)).toBe(NOT_AVAILABLE)
    })

    it('is the same for an invitation switched off', async () => {
      publish(WEDDING, { enabled: false })

      expect(await refusal()).toBe(NOT_AVAILABLE)
    })

    it('is the same for an invitation with no date', async () => {
      publish(WEDDING, { startsAt: null, timeZone: null, endsAt: null })

      expect(await refusal()).toBe(NOT_AVAILABLE)
    })

    it('is the same for an archived event', async () => {
      publish('evt-archived' as typeof WEDDING)

      expect(await refusal()).toBe(NOT_AVAILABLE)
    })

    it('is the same for an event the operator took down', async () => {
      publish(WEDDING)
      await scene.events.setTakenDown(WEDDING, new Date('2026-11-21T10:00:00Z'))

      expect(await refusal()).toBe(NOT_AVAILABLE)
    })

    it('is the same for an event of a suspended client, read by id so the freeze is seen', async () => {
      publish(FROZEN)

      expect(await refusal()).toBe(NOT_AVAILABLE)
    })

    it('is the same for an invitation whose event is gone', async () => {
      publish('evt-vanished' as typeof WEDDING)

      expect(await refusal()).toBe(NOT_AVAILABLE)
    })

    it('reads the token the way a join code is read: case and look-alikes folded', async () => {
      publish(WEDDING)

      expect(await refusal('7777-7777 7777 7777')).toBe('served')
    })
  })
})
