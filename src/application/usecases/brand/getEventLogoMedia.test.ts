import { beforeEach, describe, expect, it } from 'vitest'
import type { Event } from '../../../domain/events/event'
import { DEFAULT_EVENT_THEME } from '../../../domain/events/eventTheme'
import { ContentHash } from '../../../domain/photos/contentHash'
import { asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import { anEvent, type EventInput } from '../../testing/builders'
import { EVENT_LOGO } from '../../../domain/photos/mediaVariant'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import type { MediaViewer } from '../photos/getPhotoMedia'
import { makeGetEventLogoMedia, type GetEventLogoMedia } from './getEventLogoMedia'

const WEDDING = asEventId('evt-wedding')
const OTHER = asEventId('evt-other')

const digest = (seed: string): ContentHash => {
  const made = ContentHash.create(seed.padEnd(64, '0'))
  if (!made.ok) throw new Error('fixture digest')
  return made.value
}
const PHOTO = digest('a1')
const ELSEWHERE = digest('b2')

const PUBLIC: MediaViewer = { kind: 'public' }
const GUEST: MediaViewer = { kind: 'guest', guestId: asGuestId('guest-1') }
const MODERATOR: MediaViewer = { kind: 'moderator', userId: asUserId('user-mod') }

const eventWith = (input: EventInput = {}): Event =>
  anEvent({
    id: WEDDING,
    settings: { theme: { ...DEFAULT_EVENT_THEME, ambiance: 'guinguette' }, logo: PHOTO },
    ...input,
  })

const drain = async (chunks: AsyncIterable<Uint8Array> | null): Promise<number[]> => {
  const out: number[] = []
  if (chunks === null) throw new Error('expected bytes')
  for await (const chunk of chunks) out.push(...chunk)
  return out
}

describe('getEventLogoMedia', () => {
  let media: InMemoryMediaStore
  let getEventLogoMedia: GetEventLogoMedia

  beforeEach(async () => {
    media = new InMemoryMediaStore()
    getEventLogoMedia = makeGetEventLogoMedia({ media })
    await media.put(WEDDING, PHOTO, EVENT_LOGO, Uint8Array.of(7, 8, 9))
  })

  it.each([
    ['the public wall', PUBLIC],
    ['a guest', GUEST],
    ['a moderator', MODERATOR],
  ])('serves the named logo to %s of a live event', async (_who, viewer) => {
    const result = await getEventLogoMedia({ event: eventWith(), hash: PHOTO, viewer })

    expect(result.ok && [result.value.byteSize, result.value.contentType]).toEqual([
      3,
      'image/webp',
    ])
    expect(result.ok && (await drain(await result.value.open()))).toEqual([7, 8, 9])
  })

  it('serves a closed event, whose wall keeps playing', async () => {
    const result = await getEventLogoMedia({
      event: eventWith({ status: 'closed' }),
      hash: PHOTO,
      viewer: PUBLIC,
    })

    expect(result.ok).toBe(true)
  })

  it.each([
    ['draft', PUBLIC],
    ['draft', GUEST],
    ['archived', PUBLIC],
  ] as const)('does not serve a %s event to the public or a guest', async (status, viewer) => {
    const result = await getEventLogoMedia({ event: eventWith({ status }), hash: PHOTO, viewer })

    expect(!result.ok && result.error.code).toBe('logo.notFound')
  })

  it('lets a moderator read a draft, so the host sees the logo they just put up', async () => {
    const result = await getEventLogoMedia({
      event: eventWith({ status: 'draft' }),
      hash: PHOTO,
      viewer: MODERATOR,
    })

    expect(result.ok).toBe(true)
  })

  it('refuses a digest the event does not name, so a replaced logo is unreadable at once', async () => {
    await media.put(WEDDING, ELSEWHERE, EVENT_LOGO, Uint8Array.of(1))

    const result = await getEventLogoMedia({ event: eventWith(), hash: ELSEWHERE, viewer: PUBLIC })

    expect(!result.ok && result.error.code).toBe('logo.notFound')
  })

  it('refuses when the event names no logo at all', async () => {
    const result = await getEventLogoMedia({
      event: anEvent({ id: WEDDING }),
      hash: PHOTO,
      viewer: PUBLIC,
    })

    expect(!result.ok && result.error.code).toBe('logo.notFound')
  })

  it('does not read another event file, even for a digest both events name', async () => {
    // The lookup is (event, digest): the same digest under another event is another object,
    // and this event holds nothing under it.
    const other = anEvent({
      id: OTHER,
      slug: 'gala',
      joinCode: 'Z3N9PT',
      settings: { logo: PHOTO },
    })

    const result = await getEventLogoMedia({ event: other, hash: PHOTO, viewer: PUBLIC })

    expect(!result.ok && result.error.code).toBe('logo.notFound')
  })

  it('answers notFound when the settings name a file the disk no longer holds', async () => {
    await media.delete(WEDDING, PHOTO)

    const result = await getEventLogoMedia({ event: eventWith(), hash: PHOTO, viewer: PUBLIC })

    expect(!result.ok && result.error.code).toBe('logo.notFound')
  })

  it('opens only the bytes asked for', async () => {
    const result = await getEventLogoMedia({ event: eventWith(), hash: PHOTO, viewer: PUBLIC })

    expect(result.ok && (await drain(await result.value.open({ start: 1, end: 2 })))).toEqual([
      8, 9,
    ])
  })
})
