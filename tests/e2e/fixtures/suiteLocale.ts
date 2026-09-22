/**
 * The language every browser in this suite speaks unless a spec says otherwise.
 *
 * Its own module so that `playwright.config.ts` and `fixtures/app.ts` name **one**
 * constant. They were two answers and only one was being given: `use.locale` reaches the
 * `context` and `page` fixtures Playwright builds and **not** a manual
 * `browser.newContext()`, and `openSurfaces` opens three of those. They inherited the
 * locale of whatever machine ran the suite.
 *
 * It mattered less while the host console and the wall answered in French whoever asked.
 * Now every surface follows either its reader or its event, so a journey asserting French
 * through `surfaces.host` is green on a French laptop and red on an English runner.
 *
 * A spec that is *about* a language sets its own with `test.use({ locale })`.
 */
export const SUITE_LOCALE = 'fr-FR'
