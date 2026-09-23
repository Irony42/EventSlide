import { expect, test } from '../fixtures/app'
import { de } from '../../../web/src/lib/i18n/de'
import { it as italian } from '../../../web/src/lib/i18n/it'

/**
 * A guest whose phone is not in French, from the QR code to a refusal they can read.
 *
 * What earns ring 6 here, and what cheaper rings genuinely cannot cover:
 *
 * - **The browser's own preference.** Ring 5 stubs `navigator.languages`; only a real
 *   browser started in a real locale proves that the signal this app negotiates on is
 *   the one a phone actually sends. Playwright's `locale` option sets both that list and
 *   the `Accept-Language` header, which is the pair the roadmap item names.
 * - **A refusal that crossed HTTP.** The whole reason this point is cheap is that the
 *   server answers with `event.notFound` and the client owns the sentence. That claim is
 *   only worth anything against a real server: a route that ever composed prose would
 *   send French here and every unit test would still be green.
 * - **A real reload.** `localStorage` in jsdom is a dictionary. The requirement is that a
 *   guest who picks a language and drops the page comes back to the same one, on a phone,
 *   with no account — and a reload is the cheapest way that gets tested for real.
 * - **`<html lang>` on a real document**, which is what decides the voice a screen reader
 *   pronounces the page with.
 */

test.describe('a guest whose phone is in German', () => {
  test.use({ locale: 'de-DE' })

  test('reads the join screen, and the server’s refusal, in German @smoke', async ({
    app,
    page,
  }) => {
    const event = await app.seedEvent({ slug: 'hochzeit', name: 'Camille & Sacha' })

    await page.goto(app.url('/join'))

    // Nothing was chosen and nothing was stored: this is `navigator.languages` alone.
    await expect(page.getByRole('heading', { name: de.join.title })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')

    // A code that resolves to nothing. The server answers `404 event.notFound` with an
    // English developer message in the body, and the phone renders the German sentence
    // for the code — which is the indirection this whole roadmap point rests on.
    await page.getByLabel(de.join.codeLabel).fill('ZZZZZZ')
    await page.getByRole('button', { name: de.join.submit }).click()
    await expect(page.getByText(de.errors['event.notFound'])).toBeVisible()

    // And then the real one, through to the screen a guest actually uploads from.
    await page.getByLabel(de.join.codeLabel).fill(event.joinCode)
    await page.getByRole('button', { name: de.join.submit }).click()
    await page.waitForURL(/\/e\/[^/]+\/upload/)

    // The privacy notice, in German too (roadmap 5.1): the one screen a guest is asked to
    // read before a photo is the one screen that must not fall back to French.
    const notice = page.getByRole('region', { name: de.upload.noticeTitle })
    await expect(notice.getByText(de.upload.noticePublication.afterReview)).toBeVisible()
    await notice.getByRole('button', { name: de.upload.noticeAcknowledge }).click()

    await expect(page.getByRole('button', { name: de.upload.addPhotos })).toBeVisible()
  })

  test('keeps a language the guest picked across a reload', async ({ app, page }) => {
    await page.goto(app.url('/join'))

    await page.getByRole('combobox', { name: de.app.language }).selectOption('it')
    await expect(page.getByRole('heading', { name: italian.join.title })).toBeVisible()

    // The phone goes back in a pocket, the venue's Wi-Fi drops the page, the guest opens
    // it again. No account was involved in any of that.
    await page.reload()

    await expect(page.getByRole('heading', { name: italian.join.title })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'it')
  })

  test('renders the host console in German on the same browser, with its own picker', async ({
    app,
    page,
  }) => {
    // The decision this reversed, end to end: a moderator invited by e-mail and handed a
    // temporary password reads their console in their own language, and the picker is
    // there so a borrowed phone can be put right in one tap.
    await page.goto(app.url('/login'))

    await expect(page.getByRole('heading', { name: de.auth.title })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.getByRole('combobox', { name: de.app.language })).toBeVisible()
  })
})

/**
 * The one surface whose language is not the reader's, and the only test here where **the
 * browser is deliberately wrong**: the projector is started on a machine asking for
 * German, the event was created in Italian, and the room must get Italian.
 *
 * Nothing cheaper proves it, because every ring below stubs the very signal the wall is
 * required to ignore — a wall that quietly fell back to `navigator.languages` would be
 * green everywhere else and wrong in front of two hundred people.
 */
test.describe('a projector plugged into a laptop that is not the event’s language', () => {
  test.use({ locale: 'de-DE' })

  test('shows the room the language the host set on the event @smoke', async ({ app, page }) => {
    const event = await app.seedEvent({ name: 'Camille & Sacha', wallLanguage: 'it' })

    await page.goto(app.url(`/e/${event.slug}/display`))

    await expect(page.getByText(italian.wall.empty)).toBeVisible()
    await expect(page.getByText(de.wall.empty)).toHaveCount(0)

    await expect(page.locator('html')).toHaveAttribute('lang', 'it')
  })

  test('leaves the event’s own name exactly as the host typed it', async ({ app, page }) => {
    // Content, not interface: the name is French, the wall is Italian, and the wall shows
    // the name. A translation pass that routed it through a table would show up here.
    const event = await app.seedEvent({ name: 'Camille & Sacha', wallLanguage: 'it' })

    await page.goto(app.url(`/e/${event.slug}/display`))

    await expect(page.getByRole('heading', { name: event.name })).toBeVisible()
  })
})
