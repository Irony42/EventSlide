import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr, type Translations } from './fr'
import { it } from './it'
import type { Locale } from './locale'

/**
 * Which half of the copy is translated, and what stops the two halves drifting.
 *
 * ## The scope, and why it is not "all of it"
 *
 * A guest-facing string and a host-facing one are not the same commitment.
 *
 * The guest surface has to work **in a language the guest did not choose**: they scanned
 * a QR code at somebody else's wedding, they have one thumb and about forty seconds, and
 * a guest who cannot read the upload button does not upload. That is the whole argument
 * for this feature.
 *
 * The admin console has exactly one reader, and they are the person who installed the
 * box, typed its environment variables and read its README. The moderation console has
 * the same reader, standing up, mid-event. Translating either buys nothing and costs
 * four more tables to keep honest — and a stale translation on the one screen that
 * decides what goes on a projector is worse than French.
 *
 * So: {@link GUEST_SECTIONS} is translated into all five languages, everything else
 * stays French in every language. The split is enforced by the type of a locale table
 * rather than by anybody remembering it — see {@link GuestTranslations}.
 *
 * Three of the boundaries are worth stating because they could have gone the other way:
 *
 * - **`errors` is translated, all of it.** Most codes a host meets are host-only, and
 *   splitting the table by audience was the obvious saving. It is also the trap the
 *   video review named: it needs a rule about which route can answer which code, that
 *   rule lives nowhere in the code, and getting it wrong shows a guest French. The map
 *   is flat, the codes are cheap, and a refusal the guest cannot read is the one that
 *   makes them send the same photo four more times.
 * - **`wall` is not translated.** There is one wall and two hundred people in front of
 *   it. A per-guest cookie cannot answer "what language is this room", the event can,
 *   and that is a per-event setting rather than anything this point owns.
 * - **`auth` is not translated.** Only a host or an invited moderator ever reaches a
 *   login form; a guest has no account by construction.
 *
 * ## What stays French for every guest, and why it is not in these tables
 *
 * Two strings a guest can read are outside this module's reach entirely, and they are
 * the first and last things they see: the `<meta name="description">` in
 * `web/index.html`, which is the link preview when the join link is forwarded in a group
 * chat, and `web/public/manifest.webmanifest`, which is the name and description in the
 * install sheet on their home screen. The browser fetches both before any of this app's
 * code runs, so nothing here can negotiate them. `web/index.html` carries the full note
 * and what fixing it would take — server-side negotiation on `Accept-Language`, which is
 * a change to the delivery path rather than to the copy.
 */

/**
 * The sections a guest can read.
 *
 * `satisfies` rather than a plain annotation, so this list is checked against the real
 * table: renaming a section in `fr.ts` and forgetting this line is a compile error, not
 * a section that silently stops being translated.
 */
export const GUEST_SECTIONS = [
  'app',
  'join',
  'upload',
  'ui',
  'shell',
  'errors',
] as const satisfies readonly (keyof Translations)[]

export type GuestSection = (typeof GUEST_SECTIONS)[number]

/**
 * The same shape, with every literal widened to `string`.
 *
 * `fr.ts` is `as const`, so `fr.app.name` has the type `'EventSlide'` and not `string`.
 * That is right for the source of truth — it is what makes `layoutNames` exhaustive —
 * and useless for a second table, which would then be required to contain the French
 * words. This mapped type keeps the *keys* and the *function signatures* and gives up
 * the literals, which is exactly the contract a translation has to meet.
 */
export type Localized<T> = T extends (...args: infer A) => string
  ? (...args: A) => string
  : T extends string
    ? string
    : { readonly [K in keyof T]: Localized<T[K]> }

/** Every string in the app, for one language. What a component renders from. */
export type UiText = Localized<Translations>

/**
 * What `de.ts`, `en.ts`, `es.ts` and `it.ts` have to be.
 *
 * This is the type safety the brief asked for, and it works in both directions at once
 * because it is an exact object type checked against an object literal:
 *
 * - a key `fr.ts` has and a locale table does not is **missing property**;
 * - a key a locale table has and `fr.ts` does not is **excess property**;
 * - a host-facing section in a locale table is also an excess property, which is how the
 *   scope decision above stops being a convention and starts being a compile error;
 * - a phrase whose parameter **types** drift — `welcome(count: number)` where French
 *   takes `(eventName: string)` — is a signature mismatch.
 *
 * All four fail `npm run typecheck`, which is in `npm run verify`, which is the gate.
 *
 * **One kind of drift the compiler cannot see**, and it is worth naming because it looks
 * like it should: a phrase that declares *fewer* parameters. TypeScript assigns
 * `() => string` to `(name: string) => string` on purpose — a callback is allowed to
 * ignore what it is handed — so `clipHint: (seconds) => …` in `de.ts`, where French takes
 * `(seconds, megabytes)`, compiles cleanly and drops the megabyte limit out of the
 * sentence. Not blank, not a key name: quietly missing a number the guest needs. That one
 * is caught a ring down, by the arity case in `translations.test.ts`.
 */
export type GuestTranslations = Localized<Pick<Translations, GuestSection>>

/**
 * A locale's guest sections laid over the French table.
 *
 * This is the fallback rule, and it is a spread rather than a lookup on purpose. The
 * French entry is written first and the translated one replaces it, so a key that is
 * somehow absent at runtime — a hand-edited bundle, a table built by something other
 * than the compiler — renders the French sentence. Never `undefined`, never the empty
 * string, and never a key name on a guest's phone.
 *
 * The compiler already makes an absent key impossible, and `translations.test.ts` makes
 * an *empty* one impossible. This is the third layer, and it is free.
 */
const withFrenchFallback = (guest: GuestTranslations): UiText => ({
  ...fr,
  app: { ...fr.app, ...guest.app },
  join: { ...fr.join, ...guest.join },
  upload: { ...fr.upload, ...guest.upload },
  ui: { ...fr.ui, ...guest.ui },
  shell: { ...fr.shell, ...guest.shell },
  errors: { ...fr.errors, ...guest.errors },
})

/**
 * Every language, built once at module load — and all five in the guest's eager chunk.
 *
 * **Measured: the four non-French tables are 14.3 kB gzipped**, in the one chunk
 * `router.tsx` goes out of its way to keep small because a guest opens this app once, on
 * a phone, on congested venue Wi-Fi. A French guest at a French wedding pays for four
 * languages they will not read.
 *
 * The obvious next move is a chunk per locale — `import(\`./${locale}.ts\`)` awaited in
 * `main.tsx` before `createRoot`, so there is no flash of the wrong language — and it is
 * written down here rather than done because it is **not free**, for one specific reason
 * that is easy to miss:
 *
 * `precacheList()` in `web/vite.sw.config.ts` builds the offline shell by walking the
 * entry chunk and its **static** `imports` in Vite's manifest. A dynamic `import()`
 * lands under `dynamicImports`, which that walk does not follow — so an installed guest
 * with no connection would get the shell and no table at all, which is a blank app
 * rather than a French one. Doing it properly therefore means: an async boot path, a
 * manifest walk extended to the five locale chunks, and an answer for the guest who is
 * offline on a first visit, before the worker has installed anything. That is worth
 * having (the precache download moves after first paint, where it costs nothing) and it
 * is its own change, not a line in this one.
 */
export const TRANSLATIONS: Readonly<Record<Locale, UiText>> = {
  fr,
  de: withFrenchFallback(de),
  en: withFrenchFallback(en),
  es: withFrenchFallback(es),
  it: withFrenchFallback(it),
}

export const translationsFor = (locale: Locale): UiText => TRANSLATIONS[locale]

/**
 * The sentence for a server error code, in one language.
 *
 * The indirection this rests on is the reason roadmap 1.5 is a small change at all: the
 * server answers with a stable machine code and never with prose, so adding a language
 * is adding a column to this map and touching no route. That property was verified
 * across the whole HTTP surface rather than assumed — `ErrorBody.message` exists, but it
 * is an English string for a developer reading a log, and no client renders it.
 *
 * Unknown codes are expected: a newer server may answer with a code this build has
 * never heard of, and `event.somethingNew` on a phone is worse than a generic sentence.
 */
export const messageForCode = (code: string | undefined, text: UiText): string => {
  const table: Record<string, string | undefined> = text.errors
  /**
   * `Object.hasOwn` rather than a bare lookup. `code` is a string chosen by whatever
   * answered the request — the server, or a proxy in front of it — so a body carrying
   * `{"error":{"code":"constructor"}}` would otherwise resolve to `Object` itself and
   * hand a guest a function where a sentence belongs.
   */
  const message = code !== undefined && Object.hasOwn(text.errors, code) ? table[code] : undefined
  return message ?? text.errors.unknown
}
