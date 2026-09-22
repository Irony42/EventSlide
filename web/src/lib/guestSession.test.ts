import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readGuestSession, rememberGuestSession, rememberPrivacyNotice } from './guestSession'
import { aPrivacyNotice, aPrivacyNoticeState, aPublicEvent } from '../testing/renderWithProviders'

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
/**
 * `theme` joins `allowClips` in the exemption, and for the same reason with a different
 * answer.
 *
 * A session written before roadmap 2.2 has no theme, and refusing it would send every
 * guest in the room back to the join screen the moment the build is deployed. The
 * difference is what it is filled in with: `allowClips: false` is deliberately narrower
 * than the truth, while the default theme *is* the look that session was already
 * rendering — so nothing changes on screen at all. A theme that is present and malformed
 * is still refused, which the test below pins separately.
 */
const EVENT_FIELDS: readonly string[] = Object.keys(aPublicEvent()).filter(
  (field) => field !== 'allowClips' && field !== 'theme',
)

describe('guestSession', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('hands the join step’s answer to the upload screen', () => {
    rememberGuestSession({
      event: aPublicEvent({ slug: 'gala' }),
      displayName: 'Léa',
      privacyNotice: aPrivacyNoticeState({ acknowledgement: 'none' }),
    })

    const session = readGuestSession('gala')

    expect(session?.event.name).toBe('Camille & Sacha')
    expect(session?.displayName).toBe('Léa')
    expect(session?.privacyNotice).toEqual(aPrivacyNoticeState({ acknowledgement: 'none' }))
  })

  // ---------------------------------------------------------- privacy notice --

  it('keeps a guest who joined before the notice existed, with the notice left to fetch', () => {
    // The deploy case again, for roadmap 5.1. Refusing the entry would bounce a guest
    // with photos in their queue back to the join screen; the upload screen asks the
    // server for the notice instead.
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({ event: aPublicEvent({ slug: 'gala' }), displayName: 'Léa' }),
    )

    const session = readGuestSession('gala')

    expect(session?.event.name).toBe('Camille & Sacha')
    expect(session?.privacyNotice).toBeNull()
  })

  it.each<[rule: string, stored: unknown]>([
    ['an unknown standing', { notice: aPrivacyNotice(), acknowledgement: 'maybe' }],
    ['no revision', { notice: { ...aPrivacyNotice(), revision: 7 }, acknowledgement: 'none' }],
    [
      'an unknown publication',
      { notice: { ...aPrivacyNotice(), publication: 'never' }, acknowledgement: 'none' },
    ],
    [
      'a retention period that is not a number',
      { notice: { ...aPrivacyNotice(), retentionDays: '30' }, acknowledgement: 'none' },
    ],
    [
      'a window that is not a number',
      { notice: { ...aPrivacyNotice(), selfRemovalSeconds: {} }, acknowledgement: 'none' },
    ],
    [
      'audiences that are not a list',
      { notice: { ...aPrivacyNotice(), audiences: 'wall' }, acknowledgement: 'none' },
    ],
  ])(
    'reads a stored notice with %s as no notice, so it is fetched rather than misworded',
    (_rule, stored) => {
      sessionStorage.setItem(
        'eventslide.guest.gala',
        JSON.stringify({
          event: aPublicEvent({ slug: 'gala' }),
          displayName: null,
          privacyNotice: stored,
        }),
      )

      expect(readGuestSession('gala')?.privacyNotice).toBeNull()
    },
  )

  it('reads a notice naming an audience this build cannot word as no notice, rather than a shorter one', () => {
    // Dropping the line would tell a guest less than the truth about who sees a photo —
    // the shared gallery of roadmap 4.1 is exactly the audience a stale tab would drop.
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({
        event: aPublicEvent({ slug: 'gala' }),
        displayName: null,
        privacyNotice: {
          notice: { ...aPrivacyNotice(), audiences: ['wall', 'organisers', 'sharedGallery'] },
          acknowledgement: 'current',
        },
      }),
    )

    expect(readGuestSession('gala')?.privacyNotice).toBeNull()
  })

  it('replaces the stored notice with the server’s latest answer and keeps the rest', () => {
    rememberGuestSession({
      event: aPublicEvent({ slug: 'gala' }),
      displayName: 'Léa',
      privacyNotice: aPrivacyNoticeState({ acknowledgement: 'none' }),
    })

    rememberPrivacyNotice('gala', aPrivacyNoticeState({ acknowledgement: 'current' }))

    const session = readGuestSession('gala')
    expect(session?.privacyNotice?.acknowledgement).toBe('current')
    expect(session?.displayName).toBe('Léa')
  })

  it('writes no notice for a tab that never joined, which is on its way to the join screen', () => {
    rememberPrivacyNotice('jamais-rejoint', aPrivacyNoticeState())

    expect(readGuestSession('jamais-rejoint')).toBeNull()
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

  it('keeps a guest on the product’s own look when their session predates theming', () => {
    // The same forgiveness, for roadmap 2.2. The value filled in is the look that
    // session was already showing, so a reload changes nothing on the guest's screen —
    // and the host's colour reaches them on their next join, which is one scan away.
    const older: Record<string, unknown> = { ...aPublicEvent({ slug: 'gala' }) }
    delete older['theme']
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({ event: older, displayName: 'Léa' }),
    )

    expect(readGuestSession('gala')?.event.theme).toEqual({
      accentHue: 305,
      fonts: 'sans',
      frame: 'soft',
      material: 'glass',
    })
  })

  it('completes a theme written before the material was part of one', () => {
    // Roadmap 11.5, and the narrower version of the case above: the entry has a theme, it
    // is a theme this build can read, and it is one field short. The session the upload
    // screen receives has to carry the whole shape `PublicEventDto` promises — otherwise
    // `theme.material` is `undefined` on a phone in the room while every type says it is
    // not, and the first copy table indexed by it prints nothing.
    const older: Record<string, unknown> = { ...aPublicEvent({ slug: 'gala' }) }
    older['theme'] = { accentHue: 345, fonts: 'serif', frame: 'round' }
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({ event: older, displayName: 'Léa' }),
    )

    expect(readGuestSession('gala')?.event.theme).toEqual({
      accentHue: 345,
      fonts: 'serif',
      frame: 'round',
      material: 'glass',
    })
  })

  it('still refuses an entry whose theme is present and unreadable', () => {
    // A version is forgiven, a fault is not. A hue stored as text reaches `--accent-hue`
    // as a value the browser cannot parse, and every primary button on the screen —
    // which on this surface is the only control there is — loses its colour.
    const corrupted: Record<string, unknown> = { ...aPublicEvent({ slug: 'gala' }) }
    corrupted['theme'] = { accentHue: 'rose', fonts: 'sans', frame: 'soft', material: 'glass' }
    sessionStorage.setItem(
      'eventslide.guest.gala',
      JSON.stringify({ event: corrupted, displayName: null }),
    )

    expect(readGuestSession('gala')).toBeNull()
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

    expect(() =>
      rememberGuestSession({ event: aPublicEvent(), displayName: null, privacyNotice: null }),
    ).not.toThrow()
    expect(readGuestSession('camille-et-sacha')).toBeNull()
  })
})
