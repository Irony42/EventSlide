import { expect, joinAsGuest, test } from '../fixtures/app'

/**
 * The guest surface resolves no backdrop filter. It used to live in `frame-budget.spec.ts`, but
 * that file is the frame-rate check and runs alone, serially, in the `perf` project (see
 * `playwright.config.ts`); this assertion does not depend on how fast the machine is, so it stays
 * in the projects every guest journey runs in.
 */
test.describe('the guest surface', () => {
  test('resolves no backdrop filter on any element, and paints its pane opaque', async ({
    app,
    surfaces,
  }) => {
    // The glass material is retired (ADR 0012): the composer is `--surface-raised` and nothing
    // the guest's phone renders blurs what is behind it, which is read off the resolved style
    // of every element rather than off a stylesheet.
    const { guest } = surfaces
    const event = await app.seedEvent({ slug: 'envoi-opaque', name: 'Camille & Sacha' })

    await joinAsGuest(guest, app, event.joinCode, 'Léa')
    const composer = guest.getByTestId('upload-composer')
    await expect(composer).toBeVisible()

    const filtered = await guest.evaluate(() =>
      [...document.querySelectorAll('*')]
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          filter: getComputedStyle(element).backdropFilter,
        }))
        .filter(({ filter }) => filter !== '' && filter !== 'none')
        .map(({ tag, filter }) => `${tag}: ${filter}`),
    )
    expect(filtered).toEqual([])

    const background = await composer.evaluate((element) => getComputedStyle(element).background)
    expect(background).not.toContain('rgba')
  })
})
