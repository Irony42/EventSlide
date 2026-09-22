import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr, type Translations } from './fr'
import { it } from './it'
import type { Locale } from './locale'

/**
 * Every string in this app, in five languages, and what stops the five drifting.
 *
 * ## The scope, and why it is now all of it
 *
 * This module used to argue the opposite, and the argument is worth keeping in view
 * because it was not silly. It went: the guest surface has to work **in a language the
 * guest did not choose** — they scanned a QR code at somebody else's wedding, they have
 * one thumb and about forty seconds — while the admin console has exactly one reader, and
 * that reader installed the box and typed its environment variables, so translating it
 * buys nothing and costs four more tables to keep honest.
 *
 * Two of its three premises turned out to be false, and the third was the wrong thing to
 * optimise.
 *
 * - **The host is not the person who installed the box.** A moderator is invited by
 *   e-mail address and given a temporary password (`admin.moderatorPasswordHint`); they
 *   are a friend, a sibling, a colleague handed a phone at 21:00, and nothing about them
 *   implies they read French. The console they are handed is the one screen in this
 *   product where being wrong puts a photograph in front of two hundred people.
 * - **The room is not the host either.** The wall's copy is projected: "Rejoignez la
 *   galerie" is read by every guest, and it was in the untranslated half. The README
 *   could not even screenshot the mission panel, because it rendered "1 invité" beside
 *   English prompts.
 * - **"Four more tables to keep honest" is a cost the compiler pays, not a person.** A
 *   key added to `fr.ts` fails the build until all four carry it; `translations.test.ts`
 *   refuses a blank one, a key name copied into its own value, and a table still reading
 *   as French; `orthography.test.ts` refuses a transliterated one. What that costs is
 *   translation work, once, per string — which is the real cost and is not reduced by
 *   pretending half the app is not user-facing.
 *
 * What survives from the old argument is its best line, and it is now a *reason to be
 * careful* rather than a reason not to: **a stale translation on the screen that decides
 * what goes on a projector is worse than French.** That is what the tests below are for,
 * and it is why the pull request that landed this says plainly which of the four
 * languages deserve a native reader before anyone runs a real event in them.
 *
 * So: every section, in every language. There is no exempt half and no
 * `GUEST_SECTIONS` list to keep in step with `fr.ts` any more.
 *
 * ## Which language each surface is in
 *
 * Three surfaces, and they do not answer the question the same way, because they are not
 * asked by the same person.
 *
 * - **The guest's phone and the host's console** take the reader's own preference:
 *   `localStorage` if they have ever chosen, else `navigator.languages`, else French.
 *   `LocaleProvider` does it once, at the root, for both — a host is a person with a
 *   browser exactly as a guest is, and the same picker sits in both layouts' headers.
 * - **The projected wall** takes the **event's** `wallLanguage`, a setting the host
 *   chooses (defaulted, once, to their own language at the moment they create the event).
 *   It is the one surface with nobody in front of it: a projector's `navigator.languages`
 *   is the language of whichever machine the venue had in a cupboard, and a guest's stored
 *   preference belongs to one phone out of two hundred. `LocaleOverride` is the boundary,
 *   and `src/domain/events/eventLanguage.ts` is the argument.
 *
 * ## What is never translated, in any of them
 *
 * An event's name, a photograph's caption, a guest's display name and a mission's prompt
 * are **content**. A person wrote them, in whatever language they were speaking, and no
 * table has an entry for them — they arrive on a DTO and are interpolated verbatim. So
 * the wall routinely prints a translated heading over untranslated prompts, and that is
 * right rather than a defect: the heading is the product speaking and the prompt is the
 * host speaking.
 *
 * Routing content through a translation table would be the characteristic defect of a
 * change this size, so it is guarded by a test rather than by this paragraph:
 * `content.test.ts` calls every phrase in every language with a marked string and fails
 * if any language gives back anything other than exactly what it was handed.
 *
 * ## What is still outside this module's reach
 *
 * Two strings a guest can read are outside it entirely, and they are the first and last
 * things they see: the `<meta name="description">` in `web/index.html`, which is the link
 * preview when the join link is forwarded in a group chat, and
 * `web/public/manifest.webmanifest`, which is the name and description in the install
 * sheet on their home screen. The browser fetches both before any of this app's code
 * runs, so nothing here can negotiate them. `web/index.html` carries the full note and
 * what fixing it would take — server-side negotiation on `Accept-Language`, which is a
 * change to the delivery path rather than to the copy.
 */

/**
 * The same shape as `fr.ts`, with every literal widened to `string`.
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

/**
 * Every string in the app, for one language.
 *
 * Both what a component renders **and** what `de.ts`, `en.ts`, `es.ts` and `it.ts` have
 * to be. Those were two types while half the app was exempt; now that nothing is, they
 * are the same type and giving them two names would only invite them to drift apart
 * again.
 *
 * This is the type safety roadmap 1.5 asked for, and it works in both directions at once
 * because it is an exact object type checked against an object literal:
 *
 * - a key `fr.ts` has and a locale table does not is **missing property**;
 * - a key a locale table has and `fr.ts` does not is **excess property**;
 * - a phrase whose parameter **types** drift — `welcome(count: number)` where French
 *   takes `(eventName: string)` — is a signature mismatch.
 *
 * All three fail `npm run typecheck`, which is in `npm run verify`, which is the gate.
 *
 * **One kind of drift the compiler cannot see**, and it is worth naming because it looks
 * like it should: a phrase that declares *fewer* parameters. TypeScript assigns
 * `() => string` to `(name: string) => string` on purpose — a callback is allowed to
 * ignore what it is handed — so `clipHint: (seconds) => …` in `de.ts`, where French takes
 * `(seconds, megabytes)`, compiles cleanly and drops the megabyte limit out of the
 * sentence. Not blank, not a key name: quietly missing a number the guest needs. That one
 * is caught a ring down, by the arity case in `translations.test.ts`.
 */
export type UiText = Localized<Translations>

/** One node of a copy table, seen by something that does not know its shape. */
type Table = Readonly<Record<string, unknown>>

/**
 * `typeof 'object'` and not `'function'`, which is the distinction that makes the merge
 * below correct: a phrase is replaced whole, a section is descended into.
 */
const isTable = (value: unknown): value is Table => typeof value === 'object' && value !== null

/**
 * French first, the translation laid over it, at every depth.
 *
 * This is the fallback rule, and it is a merge rather than a lookup on purpose. The
 * French entry is written first and the translated one replaces it, so a key that is
 * somehow absent at runtime — a hand-edited bundle, a table built by something other than
 * the compiler — renders the French sentence. Never `undefined`, never the empty string,
 * and never a key name on a guest's phone.
 *
 * **Recursive, and that is not a flourish.** Six entries in these tables are nested
 * records — `wall.layoutNames` and the five `admin.*Names` — and a one-level spread would
 * replace each of them whole, so a locale table missing one layout's name would render
 * `undefined` on the one screen a host opens while standing at a projector. The
 * alternative, a hand-written spread per section, is a list somebody has to remember to
 * extend the next time a record is added; `translations.test.ts` proves this one reaches
 * the bottom instead.
 *
 * The compiler already makes an absent key impossible and `translations.test.ts` makes an
 * *empty* one impossible. This is the third layer, and it is free.
 *
 * `withFrenchFallback` is exported for one test and nothing else. The property it carries
 * — that the merge reaches the bottom — is only observable on a table that is *missing* a
 * nested key, which the compiler makes it impossible for any real table to be, so there
 * is no way to assert it through the public surface. Nothing in the running app imports
 * it; `TRANSLATIONS` below is what components reach.
 */
const layered = (base: Table, over: Table): Table => {
  const result: Record<string, unknown> = { ...base }
  for (const key of Object.keys(over)) {
    const beneath: unknown = base[key]
    const above: unknown = over[key]
    result[key] = isTable(beneath) && isTable(above) ? layered(beneath, above) : above
  }
  return result
}

/**
 * The one assertion in this file, and what makes it safe.
 *
 * `layered` cannot add a key — it starts from a copy of `fr` and only ever writes keys
 * that `over` already has, and `over` is a `UiText`, which is `fr`'s shape. It cannot
 * remove one either. So the result has exactly `fr`'s keys with exactly `UiText`'s value
 * types, which is what the assertion says; the compiler simply cannot follow an index
 * signature that far. `translations.test.ts` asserts the same thing at runtime, over
 * every key of every language, which is the guard that would actually catch a mistake
 * here.
 */
export const withFrenchFallback = (table: UiText): UiText => layered(fr, table) as UiText

/**
 * Every language, built once at module load — and all five in the guest's eager chunk.
 *
 * **Measured: the four non-French tables were 14.3 kB gzipped** when they held the guest
 * sections alone, in the one chunk `router.tsx` goes out of its way to keep small because
 * a guest opens this app once, on a phone, on congested venue Wi-Fi. Carrying the host
 * and room sections as well roughly triples that, and a French guest at a French wedding
 * pays for four languages they will not read.
 *
 * That makes the chunk-per-locale split — `import(\`./${locale}.ts\`)` awaited in
 * `main.tsx` before `createRoot`, so there is no flash of the wrong language — go from
 * "worth having" to the next thing to do. It is written down here rather than done
 * because it is **not free**, for one specific reason that is easy to miss:
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
