/**
 * The language the room's screen speaks, as a domain vocabulary.
 *
 * What is stored is a **tag**, never a sentence — the same shape as `fr.ts`'s rule that
 * the server sends a machine code and the client decides the wording. What makes it a
 * domain concern is that it is a policy of the event, like the moderation mode and the
 * accent hue: every other surface can ask the person in front of it, and a projector has
 * nobody there and a machine from the venue's cupboard for a browser.
 *
 * **It is not "the language of the evening"** and deliberately says nothing about the
 * event's *content*. A caption is written by whichever guest wrote it, and two hundred
 * guests do not share a language even when the host does — a field that claimed otherwise
 * is what something would later build a translation of a guest's caption on.
 * `admin.wallLanguageHint` says so to the host; `web/src/lib/i18n/content.test.ts` enforces
 * it in code.
 *
 * It lives in the `settings` JSON blob with every other per-event policy, so it needs no
 * migration. `sqliteEventRepository.settingsOf` has the answer for what an absent key
 * means and the tests that hold it there.
 */

/**
 * The five, in the order the guest's picker shows them.
 *
 * Declared again in `web/src/lib/api/dto.ts` and `web/src/lib/i18n/locale.ts` because the
 * web app may not import from `src/`. `eventLanguageContract.test.ts` pins all three:
 * the failure when they drift is silent — the server accepts a tag the client has no table
 * for, and the wall renders the fallback with nothing saying why.
 */
export const EVENT_LANGUAGES = ['fr', 'de', 'en', 'es', 'it'] as const

export type EventLanguage = (typeof EVENT_LANGUAGES)[number]

/**
 * What an event gets when nobody said. Almost none land here — the create form sends the
 * language the host was reading — so this is the answer for an event created through the
 * API with no opinion, and for every event that existed before the field did.
 */
export const DEFAULT_EVENT_LANGUAGE = 'fr' satisfies EventLanguage

/** Narrows a value read back from the `settings` JSON column or from a request body. */
export const isEventLanguage = (value: unknown): value is EventLanguage =>
  typeof value === 'string' && (EVENT_LANGUAGES as readonly string[]).includes(value)
