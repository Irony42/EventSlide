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
    // The decision this reversed, end to end. A moderator is invited by e-mail address
    // and handed a temporary password; nothing about them implies they read French, and
    // the console they are handed is where a photograph is let onto a projector. The
    // browser's own preference is the signal, exactly as it is for the guest — and the
    // picker is there, so a borrowed phone can be put right in one tap.
    await page.goto(app.url('/login'))

    await expect(page.getByRole('heading', { name: de.auth.title })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
    await expect(page.getByRole('combobox', { name: de.app.language })).toBeVisible()
  })
})

/**
 * The one surface whose language is not the reader's.
 *
 * This earns ring 6 for the reason the guest journey above does, and one more: it is the
 * only test in the suite where **the browser is deliberately wrong**. The projector is
 * started on a machine asking for German, the event was created in Italian, and the room
 * must get Italian. Nothing cheaper can prove that, because every ring below stubs the
 * very signal the wall is required to ignore — and a wall that quietly fell back to
 * `navigator.languages` would be green everywhere else and wrong in front of two
 * hundred people.
 *
 * It crosses two surfaces, which is what ring 6 is for: the host creates the event
 * through the API in one language and the projector reads it in another.
 */
test.describe('a projector plugged into a laptop that is not the event’s language', () => {
  test.use({ locale: 'de-DE' })

  test('shows the room the language the host set on the event @smoke', async ({ app, page }) => {
    const event = await app.seedEvent({ name: 'Camille & Sacha', wallLanguage: 'it' })

    await page.goto(app.url(`/e/${event.slug}/display`))

    // The empty state is the invitation, and it is the copy the whole room reads while
    // the first photographs are still being taken.
    await expect(page.getByText(italian.wall.empty)).toBeVisible()
    await expect(page.getByText(de.wall.empty)).toHaveCount(0)

    // And the attribute a screen reader pronounces the page with, on a real document.
    await expect(page.locator('html')).toHaveAttribute('lang', 'it')
  })

  test('leaves the event’s own name exactly as the host typed it', async ({ app, page }) => {
    // Content, not interface. The name is French, the wall is Italian, and the wall shows
    // the name — a translation pass that routed it through a table would be a real defect
    // and this is the cheapest place it would show.
    const event = await app.seedEvent({ name: 'Camille & Sacha', wallLanguage: 'it' })

    await page.goto(app.url(`/e/${event.slug}/display`))

    await expect(page.getByRole('heading', { name: event.name })).toBeVisible()
  })
})
