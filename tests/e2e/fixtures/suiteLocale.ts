/**
 * The language every browser in this suite speaks unless a spec says otherwise.
 *
 * Its own module so that `playwright.config.ts` and `fixtures/app.ts` name **one**
 * constant. That is not tidiness: they were two answers, and only one of them was being
 * given.
 *
 * `playwright.config.ts` sets `use.locale`, which Playwright applies to the `context` and
 * `page` fixtures it builds. `openSurfaces` does not use those — the product is three
 * people at three screens, so it opens three contexts of its own with
 * `browser.newContext()`, and **context options from `use` do not reach a manual
 * `newContext()`**. Those three therefore inherited the locale of whatever machine ran
 * the suite, which is the exact condition the comment on `use.locale` says was fixed.
 *
 * It mattered less before roadmap 1.5's second half: the host console and the wall
 * answered in French whoever asked, so only the guest surface was exposed. Now every
 * surface follows either the reader or the event, and a journey asserting
 * `fr.moderation.publish` through `surfaces.host` is green on a French laptop and red on
 * an English runner — a suite whose result depends on the operating system of whoever
 * ran it, which is what `playwright.config.ts` already says is not a suite.
 *
 * French, because that is the language this product's copy is written in and the one its
 * assertions are written against. A spec that is *about* a language sets its own with
 * `test.use({ locale })` — see `tests/e2e/journeys/guest-language.spec.ts` — and for the
 * three-surface fixture, `openSurfaces` is where that would have to be parameterised.
 */
export const SUITE_LOCALE = 'fr-FR'
