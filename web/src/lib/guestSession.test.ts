import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readGuestSession, rememberGuestSession } from './guestSession'
import { aPublicEvent } from '../testing/renderWithProviders'

/**
 * Taken from the builder rather than listed, so a field added to `PublicEventDto`
 * arrives here with a row of its own: a field the upload screen starts reading but
 * `isGuestSession` never checks is a field an older tab can leave undefined.
 */
const EVENT_FIELDS: readonly string[] = Object.keys(aPublicEvent())

describe('guestSession', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('hands the join step’s answer to the upload screen', () => {
    rememberGuestSession({ event: aPublicEvent({ slug: 'gala' }), displayName: 'Léa' })

    const session = readGuestSession('gala')

    expect(session?.event.name).toBe('Camille & Sacha')
    expect(session?.displayName).toBe('Léa')
  })

  it('knows nothing about an event the guest never joined', () => {
    expect(readGuestSession('jamais-rejoint')).toBeNull()
  })

  it('refuses an entry left by an older build rather than rendering half an event', () => {
    sessionStorage.setItem('eventslide.guest.gala', JSON.stringify({ event: { slug: 'gala' } }))

    expect(readGuestSession('gala')).toBeNull()
  })

  it('refuses an entry whose event is not the one asked for', () => {
    // Hand-edited storage, or a build that keyed entries differently. Showing somebody
    // else's event name is the 1.0 QR bug in miniature.
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({ event: aPublicEvent({ slug: 'mariage' }), displayName: null }),
    )

    expect(readGuestSession('gala')).toBeNull()
  })

  it('refuses a stored value that is valid JSON but not a session', () => {
    // `JSON.parse` is happy with `null` and with a bare number. Reading a field off
    // either throws, and a guest whose tab holds a leftover from another product on the
    // same origin must land on the join screen, not on a crashed upload page.
    sessionStorage.setItem('eventslide.guest.gala', 'null')

    expect(readGuestSession('gala')).toBeNull()
  })

  it('refuses an entry that carries no event at all, instead of throwing on the way out', () => {
    // Read straight through, `parsed.event.slug` on a null event throws — and this is
    // called while the upload screen renders, so the guest gets the crash boundary
    // rather than the join screen and their photo is lost.
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({ event: null, displayName: null }),
    )

    expect(readGuestSession('gala')).toBeNull()
  })

  it.each(EVENT_FIELDS)(
    'refuses an entry whose event is missing %s, rather than rendering half an event',
    (field) => {
      // Every field is one the upload screen reads without asking again: the name in
      // the heading, `allowCaptions` to decide whether the caption box exists,
      // `maxUploadBytes` to refuse a file before it leaves the phone. An entry written
      // by an older build is missing whichever field that build did not have.
      const event: Record<string, unknown> = { ...aPublicEvent({ slug: 'gala' }) }
      delete event[field]
      sessionStorage.setItem('eventslide.guest.gala', JSON.stringify({ event, displayName: null }))

      expect(readGuestSession('gala')).toBeNull()
    },
  )

  it('refuses an entry whose display name is neither text nor absent', () => {
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({ event: aPublicEvent({ slug: 'gala' }), displayName: 7 }),
    )

    expect(readGuestSession('gala')).toBeNull()
  })

  it('refuses a stored value that is not JSON at all', () => {
    sessionStorage.setItem('eventslide.guest.gala', 'not json')

    expect(readGuestSession('gala')).toBeNull()
  })

  it('survives a browser that refuses storage, instead of failing the join', () => {
    // Safari in private browsing, which is where a QR code scanned from a messaging
    // app often lands.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })

    expect(() => rememberGuestSession({ event: aPublicEvent(), displayName: null })).not.toThrow()
    expect(readGuestSession('camille-et-sacha')).toBeNull()
  })
})
