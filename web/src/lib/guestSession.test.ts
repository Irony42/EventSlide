import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readGuestSession, rememberGuestSession } from './guestSession'
import { aPublicEvent } from '../testing/renderWithProviders'

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
