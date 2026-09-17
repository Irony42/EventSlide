import type { Locale } from '../locale'

/**
 * What "spelled correctly" means, per language, as data a test can enforce.
 *
 * The French copy in this repository carries correct accents because whoever wrote it
 * cared. That does not scale to five languages: nobody reviewing a pull request is going
 * to notice that a German sentence says `fuer` instead of `für`, or that a Spanish
 * question opens with nothing, or that one `é` in a French table is `e` followed by a
 * combining acute and therefore matches no search and no `grep` anyone will ever run.
 *
 * So the rules that *can* be mechanical are, and they run over every language including
 * French — which is now checked by machine where before it was checked by care.
 *
 * A contract under `web/src/lib/i18n/testing/`, beside the walker that feeds it, for the
 * same reason `src/application/testing/contracts/` sits where it does: it describes what
 * production has to satisfy, nothing in the running app imports it, and it is excluded
 * from coverage.
 *
 * What this cannot do is tell whether a sentence is good German. It can tell whether it
 * is German that was typed by somebody with a German keyboard rather than transliterated
 * by somebody without one, and that is the failure mode this exists for.
 *
 * ## The known gap: French spacing before `? ! : ;`
 *
 * `docs/DESIGN-SYSTEM.md` §10 requires a narrow no-break space before `? ! : ;` and
 * inside `« »`, and the French table has never used one — it writes an ordinary space,
 * in roughly thirty strings, and always has. So this is a documented rule with no
 * enforcement behind it, which is the exact shape of defect the rest of this file exists
 * to remove; it is left alone here only because rewording thirty French strings is not
 * what roadmap 1.5 was asked to do, and doing it inside this branch would collide with
 * every other branch touching `fr.ts`.
 *
 * It belongs here when it is done: a per-locale rule in {@link Orthography}, since it is
 * French (and to a lesser extent Italian) typography and not Spanish or German, matched
 * against the rendered sentence exactly as {@link Orthography.transliterations} is. The
 * change is one entry in the contract plus the copy edit, and the copy edit is the whole
 * cost. Whoever picks it up should note that `NARROW_NO_BREAK_SPACE` is already in the
 * repertoire below, because `Intl` emits it.
 */

/**
 * The three spaces that legitimately appear in this copy, written as code points.
 *
 * `lib/format.ts` established the convention and the reason: an invisible character in
 * a source file is indistinguishable from an ordinary space in every review tool, so it
 * is spelled rather than typed. `Intl.NumberFormat('fr')` puts a narrow no-break space
 * inside "1 000" and a no-break space before a percent sign, and both are correct.
 */
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0)
const NARROW_NO_BREAK_SPACE = String.fromCodePoint(0x202f)
/** One entry in `upload` is a two-line paragraph; nothing else in the copy wraps. */
const NEW_LINE = String.fromCodePoint(0x000a)

/**
 * Characters every language may use: the unaccented Latin alphabet, digits, the
 * punctuation this app's copy actually contains, and those three spaces.
 *
 * This set is also what catches mojibake, which is why {@link FORBIDDEN} does not try
 * to. A UTF-8 `é` decoded as Latin-1 becomes two characters, `Ã` and `©`, and neither
 * is in any of the five repertoires — so the corruption fails the repertoire rule by
 * construction, and naming every byte pair it could produce would add a second, weaker
 * copy of a check that already holds.
 */
const SHARED = new Set([
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  // Punctuation and symbols. The typographic apostrophe is here; the ASCII one is not,
  // and that omission is the rule — see FORBIDDEN below.
  ...'.,;:!?()[]{}/&@+-–—…·%×°=<>#*',
  ...'«»„“”‘’¿¡',
  ' ',
  NO_BREAK_SPACE,
  NARROW_NO_BREAK_SPACE,
  NEW_LINE,
])

/**
 * The marks people actually get wrong, named so that the failure teaches the rule.
 *
 * The first two are also absent from {@link SHARED}, so the repertoire rule would catch
 * them on its own — as it catches a control character, a tab, and every byte of
 * mojibake. They are stated separately because "this is not the apostrophe French uses"
 * is a more useful thing to read at 2 a.m. than "U+0027 is not in the repertoire".
 *
 * The third is not: three full stops are three legitimate characters, and only a rule
 * about the *sequence* sees it.
 */
export const FORBIDDEN: readonly (readonly [pattern: RegExp, reason: string])[] = [
  [
    /'/u,
    'the ASCII apostrophe. Every language here uses the typographic one, U+2019 (’) — French needs it constantly (l’écran), Italian more so (un’immagine), and a table that mixes the two renders two different glyphs in the same paragraph.',
  ],
  [
    /"/u,
    'the ASCII double quote. Quotation marks are « » in French, Spanish and Italian, and „ “ in German.',
  ],
  [
    /\.\.\./u,
    'three full stops where the ellipsis (…) belongs. Every "Chargement…" and "Envoi…" in these tables is one character; a table that spells one of them with three sets the width of a button differently from the one beside it.',
  ],
]

export interface Orthography {
  readonly locale: Locale
  /** The accented letters this language writes, beyond the shared alphabet. */
  readonly letters: string
  /**
   * Groups of characters, at least one of which must appear somewhere in the table.
   *
   * A whole language's worth of copy with not one umlaut in it has been transliterated,
   * and a French table with not one accent in it has been through a tool that ate them.
   * Stated as "one of this group" rather than "all of these", because which particular
   * accented word a table happens to contain is a property of the copy and not of the
   * language.
   */
  readonly requires: readonly (readonly [characters: string, reason: string])[]
  /**
   * Spellings that exist only because somebody could not type the real character.
   *
   * Regexes rather than substrings, because the two kinds of entry here need different
   * boundaries and a bare substring silently picks the wrong one. A German *stem* has to
   * match inside a word — `koenn` stands for können, könnte, gekonnt — while an Italian
   * *word* must not: `cosi` is the transliteration of `così`, and as a substring it also
   * matches `cosiddetto`, which is ordinary Italian spelled correctly. Saying which is
   * which in the pattern is the only way to have both.
   *
   * Each carries its own flags; the correctly accented spelling never matches, because
   * `ü` is not `ue`.
   */
  readonly transliterations: readonly RegExp[]
}

export const ORTHOGRAPHY: Readonly<Record<Locale, Orthography>> = {
  fr: {
    locale: 'fr',
    letters: 'àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ',
    requires: [
      ['àâçéèêëîïôöùûü', 'French copy with no accented letter in it has lost them to a tool.'],
      ['’', 'French elides constantly; a table with no apostrophe at all is not French.'],
    ],
    // Stems: each is the unaccented spelling of a word this copy uses, and none of them
    // is a fragment of a correctly spelled French word.
    transliterations: [
      /evenement/iu,
      /legende/iu,
      /reessayer/iu,
      /telephone/iu,
      /apres/iu,
      /deja/iu,
      /ecran/iu,
      /reseau/iu,
      /video/iu,
      /securite/iu,
      /verifiez/iu,
    ],
  },

  de: {
    locale: 'de',
    letters: 'äöüßÄÖÜ',
    requires: [['äöüß', 'German copy with no umlaut and no Eszett has been transliterated.']],
    /**
     * Stems, matched inside a word: `koenn` has to catch könnten as well as können.
     *
     * **No `ss`-for-`ß` entries.** `weiss`, `heisst` and `ausser` were here and are gone:
     * Swiss standard German has no Eszett at all and writes exactly those spellings, so
     * the rule would have rejected correct copy for a whole variety of the language. The
     * table is written in German standard German today, which the `requires` group below
     * still pins — but a deliberate move to Swiss orthography is a decision for a human,
     * not something a spelling guard should refuse on its own.
     */
    transliterations: [
      /fuer/iu,
      /ueber/iu,
      /koenn/iu,
      /moecht/iu,
      /muess/iu,
      /groess/iu,
      /schliess/iu,
      /loesch/iu,
      /waehl/iu,
      /zurueck/iu,
      /oeffn/iu,
      /gaeste/iu,
      /spaet/iu,
      /naechst/iu,
      /aender/iu,
      /hoeh/iu,
    ],
  },

  /**
   * English requires no diacritic and transliterates none, but it does *write* several.
   *
   * The empty repertoire this used to carry was wrong rather than strict: "café",
   * "naïve" and "résumé" are English words, and the first copy edit to use one would
   * have failed the build for spelling it correctly. What is listed is what English
   * borrows, so an `ñ` or a `ß` drifting in from a neighbouring table during a
   * copy-paste is still caught — which is the property this rule is actually for.
   */
  en: {
    locale: 'en',
    letters: 'áàâäéèêëíìîïóòôöúùûüçœæÁÀÂÄÉÈÊËÍÎÏÓÔÖÚÛÜÇŒÆ',
    requires: [],
    transliterations: [],
  },

  es: {
    locale: 'es',
    letters: 'áéíóúüñÁÉÍÓÚÜÑ',
    requires: [['áéíóúñ', 'Spanish copy with no accent and no eñe has been stripped.']],
    // Stems, so `codigo` catches "códigos" too. None is a fragment of a correctly
    // spelled Spanish word.
    transliterations: [
      /anadir/iu,
      /codigo/iu,
      /numero/iu,
      /tamano/iu,
      /pequeno/iu,
      /sesion/iu,
      /aqui/iu,
      /tambien/iu,
      /pagina/iu,
      /organizacion/iu,
    ],
  },

  it: {
    locale: 'it',
    letters: 'àèéìíîòóùúÀÈÉÌÒÙ',
    requires: [
      ['àèéìòù', 'Italian copy with no accent in it has been stripped.'],
      ['’', 'Italian elides constantly; a table with no apostrophe at all is not Italian.'],
    ],
    /**
     * Whole words, every one of them, and that is the point of the change to regexes.
     *
     * Each of these is a complete Italian word that has lost its accent — `piu` for più,
     * `cosi` for così — and as substrings several of them live inside words that are
     * spelled perfectly: `cosi` is the first four letters of `cosiddetto`, `gia` of
     * `giacca`, `piu` of `piuma`. The old list papered over that with a trailing space,
     * which both missed the word at the end of a sentence and did nothing for `cosi`.
     * `\b` on both sides says what was meant.
     */
    transliterations: [
      /\bpiu\b/iu,
      /\bpuo\b/iu,
      /\bperche\b/iu,
      /\bcosi\b/iu,
      /\bgia\b/iu,
      /\bqualita\b/iu,
      /\bcitta\b/iu,
      /\bverra\b/iu,
      /\bfinche\b/iu,
      /\bliberta\b/iu,
    ],
  },
}

/** Every character this language is allowed to write. */
export const repertoireFor = (locale: Locale): ReadonlySet<string> =>
  new Set([...SHARED, ...ORTHOGRAPHY[locale].letters])
