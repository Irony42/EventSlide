/**
 * What the service worker does with a push message (spec 30, lot 4, Web Push): read it, word it in
 * the reader's language, and on a click bring the Réponses page of the event to the front.
 *
 * Kept out of `web/sw/serviceWorker.ts` (which belongs to no vitest project) so that all of it is
 * ordinary, tested code; the worker only wires the browser's events to it. It touches no `document`
 * and no `navigator`, which is what makes it safe to import there.
 *
 * The message the server sends is `{v: 1, type: 'rsvp.new', slug, count}` and nothing else: it says
 * that replies came in and how many, never who or what.
 */

export interface RsvpNotice {
  readonly slug: string
  readonly count: number
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u
const MOST_REPLIES = 100_000

/** The message, or `null` for anything that is not exactly what this box sends. */
export const parseRsvpNotice = (data: unknown): RsvpNotice | null => {
  if (typeof data !== 'object' || data === null) return null
  const { v, type, slug, count } = data as Record<string, unknown>
  if (v !== 1 || type !== 'rsvp.new') return null
  if (typeof slug !== 'string' || !SLUG.test(slug)) return null
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MOST_REPLIES) {
    return null
  }
  return { slug, count }
}

/** Where a click goes: the host's Réponses page of the event. */
export const repliesPath = (slug: string): string =>
  `/admin/events/${encodeURIComponent(slug)}/rsvps`

/** One notification per event: a second message replaces the first instead of stacking. */
export const notificationTag = (slug: string): string => `eventslide-rsvp-${slug}`

type Words = {
  readonly title: string
  readonly one: string
  readonly other: (count: number) => string
  readonly some: string
}

const NBSP = ' '

/** The five languages of the app; the worker has no locale table of its own, so this is its own. */
const WORDS: Readonly<Record<string, Words>> = {
  fr: {
    title: 'EventSlide',
    one: 'Une nouvelle réponse',
    other: (count) => `${count}${NBSP}nouvelles réponses`,
    some: 'De nouvelles réponses',
  },
  en: {
    title: 'EventSlide',
    one: 'One new reply',
    other: (count) => `${count} new replies`,
    some: 'New replies',
  },
  de: {
    title: 'EventSlide',
    one: 'Eine neue Antwort',
    other: (count) => `${count} neue Antworten`,
    some: 'Neue Antworten',
  },
  es: {
    title: 'EventSlide',
    one: 'Una respuesta nueva',
    other: (count) => `${count} respuestas nuevas`,
    some: 'Respuestas nuevas',
  },
  it: {
    title: 'EventSlide',
    one: 'Una nuova risposta',
    other: (count) => `${count} nuove risposte`,
    some: 'Nuove risposte',
  },
}

/** The language of a BCP 47 tag among the five, English for any other. */
export const languageOf = (tag: string | undefined): keyof typeof WORDS & string => {
  const base = (tag ?? '').toLowerCase().split('-')[0] ?? ''
  return base in WORDS ? base : 'en'
}

/** What the notification says: `count` is `null` when the message could not be read. */
export const noticeText = (
  count: number | null,
  tag: string | undefined,
): { readonly title: string; readonly body: string } => {
  const words = WORDS[languageOf(tag)] as Words
  if (count === null) return { title: words.title, body: words.some }
  return { title: words.title, body: count === 1 ? words.one : words.other(count) }
}

/** A window of the app, as much of it as a click needs. */
export interface OpenWindow {
  readonly url: string
  focus(): Promise<unknown>
  navigate?(url: string): Promise<unknown>
}

/**
 * A click on the notification: the window already showing that page is focused; another window of
 * the app is taken there; with none, one is opened. Never opens a second copy of a page that is open.
 */
export const openRepliesPage = async (
  windows: readonly OpenWindow[],
  origin: string,
  path: string,
  open: (url: string) => Promise<unknown>,
): Promise<void> => {
  const target = `${origin}${path}`
  const here = windows.find((window) => window.url.split(/[?#]/u)[0] === target)
  if (here !== undefined) {
    await here.focus()
    return
  }
  const other = windows.find((window) => window.url.startsWith(`${origin}/`))
  if (other?.navigate !== undefined) {
    await other.navigate(target)
    await other.focus()
    return
  }
  await open(target)
}
