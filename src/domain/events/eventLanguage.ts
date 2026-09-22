/**
 * The language the room's screen speaks, as a domain vocabulary.
 *
 * ## Why the domain knows about languages at all
 *
 * It does not know about *words*. `web/src/lib/i18n/fr.ts` rule 1 is that the server
 * never sends French — it sends a stable machine code and the client decides the
 * wording — and this is the same shape one level up: what is stored here is a **tag**,
 * five characters of vocabulary, and not a sentence. Nothing in `src/` renders it.
 *
 * What makes it a domain concern is that it is a **policy of the event**, exactly like
 * the moderation mode, the retention window and the accent hue. Every other surface can
 * ask the person in front of it what language to use: a guest's phone has
 * `navigator.languages` and a picker in the header, a host's browser has both. The wall
 * has neither — it is a projector in a room with two hundred people in it and nobody
 * holding it, and the machine plugged into it is whatever the venue had in a cupboard.
 * The only party who can answer for that screen is the host, so the answer is stored on
 * the thing they own.
 *
 * ## What it is not
 *
 * It is **not** "the language of the evening", and it deliberately does not claim to
 * describe the event's *content*. A caption is written by whichever guest wrote it, and
 * two hundred guests do not share a language even when the host does — so no single
 * field could be true about them. A field that claimed otherwise would be the first
 * thing something built a translation, a transliteration or a spell-check on, and
 * rewriting what a guest typed under their own photograph is the one defect this whole
 * area exists to prevent. The host-facing copy says so in as many words
 * (`admin.wallLanguageHint`).
 *
 * So the wall routinely renders a translated chrome around untranslated content, and
 * that is correct rather than a bug: the chrome is the product speaking and the caption
 * is a guest speaking.
 *
 * ## Why it is not a column
 *
 * It lives in the `settings` JSON blob with every other per-event policy, so it needs no
 * migration. A column would buy a query nobody makes, and split one policy object across
 * two storage shapes. `sqliteEventRepository.settingsOf` already has the established
 * answer for what an absent key means — see the note there, which is this field's.
 */

/**
 * The five, in the order the guest's picker shows them — French first because it is the
 * default, then the other four alphabetically by their own name.
 *
 * This list and `SUPPORTED_LOCALES` in `web/src/lib/i18n/locale.ts` are two independent
 * declarations of one fact, for the reason `web/src/lib/api/dto.ts` is a second copy of
 * the wire: the web app may not import from `src/`. They are pinned against each other
 * by `eventLanguageContract.test.ts`, because the failure when they drift is silent —
 * the server would accept a tag the client has no table for, and the wall would render
 * the fallback language with nothing anywhere saying why.
 */
export const EVENT_LANGUAGES = ['fr', 'de', 'en', 'es', 'it'] as const

export type EventLanguage = (typeof EVENT_LANGUAGES)[number]

/**
 * What an event gets when nobody said.
 *
 * French, which is the language this product is written in and the one its author
 * supports — the same default `web/src/lib/i18n/locale.ts` states for the guest. In
 * practice almost no event lands here: the create form sends the language the host was
 * reading at that moment, and this is the answer for an event created through the API
 * with no opinion, and for every event that existed before the field did.
 */
export const DEFAULT_EVENT_LANGUAGE = 'fr' satisfies EventLanguage

/** Narrows a value read back from the `settings` JSON column or from a request body. */
export const isEventLanguage = (value: unknown): value is EventLanguage =>
  typeof value === 'string' && (EVENT_LANGUAGES as readonly string[]).includes(value)
