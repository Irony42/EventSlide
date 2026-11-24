import { describe, expect, it, vi } from 'vitest'
import {
  languageOf,
  noticeText,
  notificationTag,
  openRepliesPage,
  parseRsvpNotice,
  repliesPath,
  type OpenWindow,
} from './pushNotice'

/**
 * What the service worker does with a push (spec 30, lot 4): read exactly what the box sends, word it
 * in the browser's language, and take a click to the Réponses page of that event without opening a
 * second copy of it.
 */

describe('the message', () => {
  it('is read when it is exactly what the box sends', () => {
    expect(parseRsvpNotice({ v: 1, type: 'rsvp.new', slug: 'camille-et-sacha', count: 3 })).toEqual(
      {
        slug: 'camille-et-sacha',
        count: 3,
      },
    )
  })

  it.each([
    ['nothing', undefined],
    ['text', 'rsvp.new'],
    ['null', null],
    ['another version', { v: 2, type: 'rsvp.new', slug: 'a', count: 1 }],
    ['another type', { v: 1, type: 'photo.new', slug: 'a', count: 1 }],
    ['a slug that is a path', { v: 1, type: 'rsvp.new', slug: '../admin', count: 1 }],
    ['a slug that is not text', { v: 1, type: 'rsvp.new', slug: 4, count: 1 }],
    ['an empty slug', { v: 1, type: 'rsvp.new', slug: '', count: 1 }],
    ['a count of zero', { v: 1, type: 'rsvp.new', slug: 'a', count: 0 }],
    ['a fractional count', { v: 1, type: 'rsvp.new', slug: 'a', count: 1.5 }],
    ['a count that is text', { v: 1, type: 'rsvp.new', slug: 'a', count: '2' }],
    ['an absurd count', { v: 1, type: 'rsvp.new', slug: 'a', count: 1_000_000 }],
  ])('is refused when it is %s', (_name, data) => {
    expect(parseRsvpNotice(data)).toBeNull()
  })

  it('goes to the event’s Réponses page, whatever the slug holds', () => {
    expect(repliesPath('camille-et-sacha')).toBe('/admin/events/camille-et-sacha/rsvps')
    expect(repliesPath('a b')).toBe('/admin/events/a%20b/rsvps')
    expect(notificationTag('camille-et-sacha')).toBe('eventslide-rsvp-camille-et-sacha')
  })
})

describe('the words', () => {
  it('are the browser’s language among the five, English for any other', () => {
    expect(languageOf('fr-FR')).toBe('fr')
    expect(languageOf('DE')).toBe('de')
    expect(languageOf('es-MX')).toBe('es')
    expect(languageOf('it')).toBe('it')
    expect(languageOf('ja')).toBe('en')
    expect(languageOf(undefined)).toBe('en')
    expect(languageOf('')).toBe('en')
  })

  it('count the replies, in French with a non-breaking space', () => {
    expect(noticeText(1, 'fr').body).toBe('Une nouvelle réponse')
    expect(noticeText(3, 'fr').body).toBe('3 nouvelles réponses')
    expect(noticeText(3, 'en').body).toBe('3 new replies')
    expect(noticeText(1, 'en').body).toBe('One new reply')
    expect(noticeText(2, 'de').body).toBe('2 neue Antworten')
    expect(noticeText(2, 'es').body).toBe('2 respuestas nuevas')
    expect(noticeText(2, 'it').body).toBe('2 nuove risposte')
  })

  it('say that something came in when the message could not be read', () => {
    expect(noticeText(null, 'fr')).toEqual({ title: 'EventSlide', body: 'De nouvelles réponses' })
    expect(noticeText(null, 'en').body).toBe('New replies')
    expect(noticeText(null, 'de').body).toBe('Neue Antworten')
    expect(noticeText(null, 'es').body).toBe('Respuestas nuevas')
    expect(noticeText(null, 'it').body).toBe('Nuove risposte')
  })

  it('name no guest: nothing but the app and a count', () => {
    for (const language of ['fr', 'en', 'de', 'es', 'it']) {
      const { title, body } = noticeText(4, language)
      expect(title).toBe('EventSlide')
      expect(body).not.toMatch(/[A-Z][a-z]+ [A-Z]/u)
    }
  })
})

describe('a click on the notification', () => {
  const ORIGIN = 'https://app.eventslide.fr'
  const PATH = '/admin/events/fete/rsvps'
  const window = (
    url: string,
    navigate = true,
  ): OpenWindow & { focus: ReturnType<typeof vi.fn> } => ({
    url,
    focus: vi.fn(async () => undefined),
    ...(navigate ? { navigate: vi.fn(async () => undefined) } : {}),
  })

  it('focuses the window that already shows the page, query or hash apart, and opens nothing', async () => {
    const shown = window(`${ORIGIN}${PATH}?reply=r1#top`)
    const other = window(`${ORIGIN}/admin`)
    const open = vi.fn(async () => undefined)

    await openRepliesPage([other, shown], ORIGIN, PATH, open)

    expect(shown.focus).toHaveBeenCalledTimes(1)
    expect(other.focus).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('takes another window of the app to the page and focuses it', async () => {
    const other = window(`${ORIGIN}/admin`)
    const open = vi.fn(async () => undefined)

    await openRepliesPage([window('https://elsewhere.example/'), other], ORIGIN, PATH, open)

    expect(other.navigate).toHaveBeenCalledWith(`${ORIGIN}${PATH}`)
    expect(other.focus).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens a window when there is none of the app, or one that cannot be moved', async () => {
    const open = vi.fn(async () => undefined)

    await openRepliesPage([], ORIGIN, PATH, open)
    await openRepliesPage([window(`${ORIGIN}/admin`, false)], ORIGIN, PATH, open)
    await openRepliesPage([window(`${ORIGIN}.evil.test/admin`)], ORIGIN, PATH, open)

    expect(open).toHaveBeenCalledTimes(3)
    expect(open).toHaveBeenCalledWith(`${ORIGIN}${PATH}`)
  })
})
