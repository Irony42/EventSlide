import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readGuestSession, rememberGuestSession } from './guestSession'
import { aPublicEvent } from '../testing/renderWithProviders'

/**
 * Taken from the builder rather than listed, so a field added to `PublicEventDto`
 * arrives here with a row of its own: a field the upload screen starts reading but
 * `isGuestSession` never checks is a field an older tab can leave undefined.
 *
 * The three clip fields are the exception, and the exception is the interesting case
 * rather than a hole. A session written before video shipped has none of them, and
 * rejecting it would log every guest already in the room out of the upload screen at the
 * moment the new build is deployed — mid-evening, with photos in their queue. They are
 * filled in as "this gallery has no video" instead, which is what that session knew when
 * it was written; the test below pins that, and it is the one behaviour here that a
 * deploy can get wrong in front of a hundred people.
 */
const OLDER_THAN_VIDEO: readonly string[] = ['allowClips', 'maxClipBytes', 'maxClipSeconds']

/**
 * Only `allowClips` is exempt, and the exemption is that narrow on purpose.
 *
 * It is the field that says whether the entry was written by a build that knew about
 * video, so its absence is a version and not a fault. The two **limits** stay in the
 * list: the upload screen reads them without asking again, and an entry carrying a
 * garbage `maxClipBytes` would put "NaN Mo maximum" in the picker's hint and refuse
 * nothing at all on size — which is the whole defect this narrowing exists to prevent,
 * reintroduced by the compatibility fix.
 */
const EVENT_FIELDS: readonly string[] = Object.keys(aPublicEvent()).filter(
  (field) => field !== 'allowClips',
)

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

  it('keeps a guest who joined before video shipped, with video simply off', () => {
    // The deploy case, and the one that matters: a guest already in the room, with
    // photos in their queue, must not be bounced to the join screen because the build
    // changed under them. Their session is older than the feature, not broken by it.
    const older: Record<string, unknown> = { ...aPublicEvent({ slug: 'gala' }) }
    for (const field of OLDER_THAN_VIDEO) delete older[field]
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({ event: older, displayName: 'Léa' }),
    )

    const session = readGuestSession('gala')

    expect(session?.event.name).toBe('Camille & Sacha')
    // Off rather than guessed: the composer keys off this, so the guest keeps sending
    // photos and video appears the next time they scan the code.
    expect(session?.event.allowClips).toBe(false)
  })

  it('still refuses an entry that kept the clip limits but lost their types', () => {
    // The compatibility path above forgives a **version**, never a fault. A stored
    // `maxClipBytes` that is not a number reaches the picker's hint as "NaN Mo maximum"
    // and refuses nothing at all on size, which is exactly what the narrowing is for.
    const corrupted: Record<string, unknown> = { ...aPublicEvent({ slug: 'gala' }) }
    corrupted['maxClipBytes'] = 'quatre-vingts'
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({ event: corrupted, displayName: null }),
    )

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
