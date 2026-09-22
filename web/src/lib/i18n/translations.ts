import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr, type Translations } from './fr'
import { it } from './it'
import type { Locale } from './locale'

/**
 * Every string in this app, in five languages.
 *
 * **This module used to argue for translating only the guest's half**, on the grounds that
 * the admin console "has exactly one reader, and they are the person who installed the
 * box". Two premises to keep, because they are the reasons not to reinstate it: a
 * moderator is invited by e-mail and handed a temporary password, so nothing implies they
 * read French — and the `wall` copy is *projected*. What survives is its best line, now a
 * reason to be careful rather than not to: a stale translation on the screen that decides
 * what goes on a projector is worse than French.
 *
 * **Which language each surface is in.** The guest's phone and the host's console take the
 * reader's own preference, resolved once by `LocaleProvider`. The projected wall takes the
 * **event's** `wallLanguage`, because it is the one surface with nobody in front of it —
 * `LocaleOverride` is the boundary and `src/domain/events/eventLanguage.ts` the argument.
 *
 * **What is never translated** is what people write: an event's name, a caption, a display
 * name, a mission prompt. So the wall prints a translated heading over untranslated
 * prompts, which is right — the heading is the product speaking and the prompt is the
 * host. `content.test.ts` enforces it.
 *
 * Two strings stay outside this module's reach: `web/index.html`'s `<meta description>`
 * and `manifest.webmanifest`, fetched before any of this code runs. `web/index.html`
 * carries the note and what fixing it would take.
 */

/**
 * The same shape as `fr.ts`, with every literal widened to `string`. `fr.ts` is `as const`,
 * which makes `layoutNames` exhaustive and would otherwise require a second table to
 * contain the French words.
 */
export type Localized<T> = T extends (...args: infer A) => string
  ? (...args: A) => string
  : T extends string
    ? string
    : { readonly [K in keyof T]: Localized<T[K]> }

/**
 * Every string in the app, for one language: what a component renders **and** what
 * `de.ts`, `en.ts`, `es.ts` and `it.ts` have to be. Two types while half the app was
 * exempt; one name now, so they cannot drift apart again.
 *
 * A missing key, an excess key and a drifted parameter *type* all fail
 * `npm run typecheck`. **The compiler cannot see a phrase that declares *fewer*
 * parameters** — `() => string` is assignable to `(name: string) => string`, so
 * `clipHint: (seconds) => …` compiles and drops the megabyte limit out of the sentence.
 * Both are covered in `translations.test.ts`, by `@ts-expect-error` cases and the arity
 * case respectively.
 */
export type UiText = Localized<Translations>

/** One node of a copy table, seen by something that does not know its shape. */
type Table = Readonly<Record<string, unknown>>

/** `object` and not `function`: a phrase is replaced whole, a section descended into. */
const isTable = (value: unknown): value is Table => typeof value === 'object' && value !== null

/**
 * French first, the translation laid over it, at every depth: a key somehow absent at
 * runtime renders the French sentence rather than `undefined`.
 *
 * **Recursive, and that is not a flourish** — six entries are nested records, and a
 * one-level spread would replace each whole. `translations.test.ts > lays French under a
 * translation all the way down` guards it.
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
 * The one assertion in this file, safe because `layered` starts from a copy of `fr` and
 * only writes keys `over` already has — the compiler simply cannot follow an index
 * signature that far. Exported for one test: the property is only observable on a table
 * *missing* a nested key, which the compiler makes impossible for a real one.
 */
export const withFrenchFallback = (table: UiText): UiText => layered(fr, table) as UiText

/**
 * Every language, built once at module load — and all five in the guest's eager chunk.
 *
 * **Measured: the four non-French tables were 14.3 kB gzipped** carrying the guest
 * sections alone, and all eleven roughly triples that, on the chunk `router.tsx` goes out
 * of its way to keep small. A chunk per locale is therefore the next thing to do, and it
 * is **not free**: `precacheList()` in `web/vite.sw.config.ts` walks only **static**
 * imports, so a dynamic `import()` leaves an installed guest with no table at all offline.
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
 * The sentence for a server error code, in one language. The server answers with a stable
 * machine code and never with prose, which is why adding a language touches no route.
 * Unknown codes are expected — `event.somethingNew` on a phone is worse than a generic
 * sentence.
 */
export const messageForCode = (code: string | undefined, text: UiText): string => {
  const table: Record<string, string | undefined> = text.errors
  // `Object.hasOwn` rather than a bare lookup: `code` is chosen by whatever answered the
  // request, so `{"error":{"code":"constructor"}}` would otherwise resolve to `Object`
  // itself and hand a guest a function where a sentence belongs.
  const message = code !== undefined && Object.hasOwn(text.errors, code) ? table[code] : undefined
  return message ?? text.errors.unknown
}
