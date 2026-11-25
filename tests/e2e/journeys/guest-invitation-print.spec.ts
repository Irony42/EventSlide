import { csrfHeaders, expect, test } from '../fixtures/app'
import type { Locator, Page } from '@playwright/test'
import { jpegWithLocation } from '../fixtures/media'
import { decodeQr } from '../fixtures/qrDecode'
import { backToCard, openShare } from '../fixtures/invitationPanels'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The invitation card on paper, from the host's tab to what a phone reads (spec 29, PR 4).
 *
 * What no cheaper ring can answer: **does the QR on the printed card lead to the invitation's link,
 * and does the console stay off the paper?** The card is decoded from a screenshot of the printed
 * element, the way `print-kit.spec.ts` reads the table cards, and must read back exactly the link
 * the host sees. The address is on the card, the format counts are four and two, and in print media
 * the console's own chrome and the form are gone.
 *
 * Chromium desktop only: print rendering is a Chromium behaviour the other engines would repeat.
 */

const text = fr.guestInvite.host

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'print rendering is a Chromium behaviour; the other engines would assert the same',
  )
})

test('the printed card carries the invitation link as a QR, the address, and nothing of the console', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'carte-invitation', name: 'Léa fête ses 40 ans' })
  const headers = await csrfHeaders(host.request, app)
  const saved = await host.request.put(app.url(`/api/events/${event.slug}/guest-invite`), {
    headers,
    data: {
      title: 'Léa fête ses 40 ans',
      startsAt: '2027-12-11T18:00:00Z',
      endsAt: '2027-12-12T01:00:00Z',
      // Far from Paris and from UTC: the hours on the card are those of THIS zone, or of nobody's.
      timeZone: 'Asia/Tokyo',
      venueName: 'La Guinguette du Port',
      address: '12 quai de la Loire\n44000 Nantes',
      message: 'Venez comme vous êtes.',
      language: 'fr',
    },
  })
  expect(saved.status()).toBe(200)
  const enabled = await host.request.post(
    app.url(`/api/events/${event.slug}/guest-invite/enable`),
    { headers, data: {} },
  )
  expect(enabled.status()).toBe(200)
  const { guestInvite } = (await enabled.json()) as { guestInvite: { url: string } }

  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=partage`))
  const sheet = host.locator('[data-format]')
  const panel = host.getByRole('region', { name: text.sharePanelTitle })
  const tablist = host.getByRole('tablist')
  const word = host.getByRole('textbox', { name: text.shortLabel })
  const printButton = host.getByRole('button', { name: text.printButton })

  for (const format of [
    { name: text.printFormatCard, value: 'card', copies: 4, landscape: false },
    { name: text.printFormatA5, value: 'a5', copies: 2, landscape: true },
  ] as const) {
    await host.emulateMedia({ media: 'screen' })
    await host.getByRole('radio', { name: format.name }).check()
    await expect(sheet).toHaveAttribute('data-format', format.value)
    await expect(sheet.getByRole('img', { name: /QR/ })).toHaveCount(format.copies)
    // All of this is on the screen first, so that "hidden on paper" below cannot pass on nothing.
    for (const onScreen of [panel, tablist, word, printButton]) await expect(onScreen).toBeVisible()

    await host.emulateMedia({ media: 'print' })
    // The console's header, footer, panel, tabs and controls do not print; the card does.
    await expect(host.locator('header')).toBeHidden()
    await expect(host.locator('footer')).toBeHidden()
    await expect(host.getByRole('button', { name: 'Compte' })).toBeHidden()
    for (const offPaper of [printButton, tablist, panel, word]) await expect(offPaper).toBeHidden()
    await expect(sheet).toBeVisible()

    // The card says the hours of the zone of the party (Tokyo), not the browser's and not Paris's.
    await expect(sheet.first()).toContainText('12 quai de la Loire')
    await expect(sheet.first()).toContainText('dimanche 12 décembre 2027')
    await expect(sheet.first()).toContainText('3 h – 10 h')
    await expect(sheet.first()).not.toContainText('19 h')

    // One sheet, one page: A4 portrait for the A6 cards, A4 landscape for the A5.
    const pages = await pagesOf(host)
    expect(pages).toHaveLength(1)
    const [width, height] = pages[0] ?? [0, 0]
    expect(Math.round(Math.min(width, height))).toBe(595)
    expect(Math.round(Math.max(width, height))).toBe(842)
    expect(width > height).toBe(format.landscape)

    // A reader finds the invitation's link in what the paper shows.
    expect(await decodeQr(sheet.getByRole('img', { name: /QR/ }).first())).toBe(guestInvite.url)
  }
})

test('every design of the first lot reads back the invitation link, prints its address on one page, and keeps the photo', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'carte-designs', name: 'Léa fête ses 40 ans' })
  const headers = await csrfHeaders(host.request, app)
  await host.request.put(app.url(`/api/events/${event.slug}/guest-invite`), {
    headers,
    data: {
      title: 'Léa fête ses 40 ans',
      startsAt: '2027-12-11T18:00:00Z',
      endsAt: '2027-12-12T01:00:00Z',
      timeZone: 'Europe/Paris',
      venueName: 'La Guinguette du Port',
      address: '12 quai de la Loire\n44000 Nantes',
      message: 'Venez comme vous êtes, avec une photo de vous petit pour le mur.',
      language: 'fr',
    },
  })
  const enabled = await host.request.post(
    app.url(`/api/events/${event.slug}/guest-invite/enable`),
    { headers, data: {} },
  )
  const { guestInvite } = (await enabled.json()) as { guestInvite: { url: string } }

  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  const sheet = host.locator('[data-format]')
  const card = sheet.locator('[data-print-card]').first()

  // A photograph, chosen once on a design that prints one, is on the card and survives a reload.
  await host.getByRole('radio', { name: 'Billet' }).check({ force: true })
  await host.getByTestId('print-photo-input').setInputFiles(await jpegWithLocation('photo'))
  await expect(card.locator('img[src^="data:image/jpeg"]')).toBeVisible()
  await host.reload()
  await expect(
    sheet.locator('[data-print-card="billet"] img[src^="data:image/jpeg"]').first(),
  ).toBeVisible()

  for (const design of [
    { name: 'Essentiel', id: 'essentiel' },
    { name: 'Ticket de caisse', id: 'ticket' },
    { name: 'Souvenir', id: 'souvenir' },
    { name: 'Billet', id: 'billet' },
    { name: 'Carte d’embarquement', id: 'embarquement' },
    { name: 'Guirlande', id: 'guirlande' },
  ]) {
    await host.emulateMedia({ media: 'screen' })
    await backToCard(host)
    await host.getByRole('radio', { name: design.name }).check({ force: true })
    // The card's own screen shows one large card; the sheet is what sharing prints.
    await expect(card).toHaveAttribute('data-print-card', design.id)
    await expect(card).toContainText('12 quai de la Loire')
    await expect(card).toContainText('19 h')
    await expect(sheet).toHaveAttribute('data-single', '')

    await openShare(host)
    await expect(sheet).not.toHaveAttribute('data-single', '')
    await host.emulateMedia({ media: 'print' })
    await expect(sheet).toBeVisible()
    expect(await pagesOf(host), design.id).toHaveLength(1)
    expect(await decodeQr(sheet.getByRole('img', { name: /QR/ }).first()), design.id).toBe(
      guestInvite.url,
    )
  }
})

const LONG = {
  title: 'Mariage de Camille et Sacha au Domaine',
  startsAt: '2027-12-11T18:30:00Z',
  endsAt: '2027-12-13T01:30:00Z',
  timeZone: 'Europe/Paris',
  venueName: 'Domaine des Grands Tilleuls et de la Vallée',
  address:
    '1204 route des Grands Tilleuls, Le Grand Pré, bâtiment B\n44000 Nantes, Loire-Atlantique, Pays de la Loire',
  message:
    'Apéro à 19 h 30, dîner à 20 h 30, puis on danse jusqu’au bout de la nuit. Venez comme vous êtes, avec le sourire et une photo de vous petit. Pensez à prévenir de votre arrivée.',
}

/** A6 is 105 mm wide: 7 pt is 2.35 cqw, 6.5 pt is 2.18 cqw. */
const FLOOR_WORD_CQW = 2.35
const FLOOR_LINK_CQW = 2.18

for (const language of ['fr', 'en'] as const) {
  test(
    'the longest case (' + language + ') stays legible and inside the card on every design',
    async ({ app, surfaces }) => {
      const { host } = surfaces
      const event = await app.seedEvent({ slug: 'carte-longue', name: LONG.title })
      const headers = await csrfHeaders(host.request, app)
      await host.request.put(app.url('/api/events/' + event.slug + '/guest-invite'), {
        headers,
        data: { ...LONG, language },
      })
      await host.request.post(app.url('/api/events/' + event.slug + '/guest-invite/enable'), {
        headers,
        data: {},
      })
      await host.goto(app.url('/admin/events/' + event.slug + '/invitations'))
      const card = host.locator('[data-format] [data-print-card]').first()

      await expect(card).toBeVisible()
      await host.evaluate(() => document.fonts.ready)
      // Every thumbnail of the picker draws the Essentiel line at the card's scale, not at the page's.
      const thumbnails = await host.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-print-card="essentiel"]')].flatMap(
          (card) => {
            const more = card.querySelector('[class*="esMore"]')
            if (more === null) return []
            return [
              (parseFloat(getComputedStyle(more).fontSize) / card.getBoundingClientRect().width) *
                100,
            ]
          },
        ),
      )
      expect(thumbnails.length).toBeGreaterThan(1)
      for (const ratio of thumbnails) expect(ratio).toBeGreaterThan(2.2)
      for (const ratio of thumbnails) expect(ratio).toBeLessThan(3.5)

      for (const design of [
        { name: 'Essentiel', id: 'essentiel' },
        { name: 'Ticket de caisse', id: 'ticket' },
        { name: 'Souvenir', id: 'souvenir' },
        { name: 'Billet', id: 'billet' },
        { name: 'Carte d’embarquement', id: 'embarquement' },
        { name: 'Guirlande', id: 'guirlande' },
      ]) {
        await host.getByRole('radio', { name: design.name }).check({ force: true })
        await expect(card).toHaveAttribute('data-print-card', design.id)
        await host.evaluate(() => document.fonts.ready)

        const measure = (target: Locator) =>
          target.evaluate(
            (root, floors) => {
              const width = root.getBoundingClientRect().width
              const card = root.getBoundingClientRect()
              const clipped = (element: Element): boolean => {
                const box = element.getBoundingClientRect()
                if (box.bottom > card.bottom + 0.5 || box.right > card.right + 0.5) return true
                for (
                  let up = element.parentElement;
                  up !== null && up !== root;
                  up = up.parentElement
                ) {
                  if (getComputedStyle(up).overflow === 'visible') continue
                  const outer = up.getBoundingClientRect()
                  if (box.bottom > outer.bottom + 1 || box.right > outer.right + 1) return true
                }
                return false
              }
              const out: string[] = []
              for (const element of root.querySelectorAll<HTMLElement>('p[data-fit]')) {
                const floor = floors.word // every shrinkable paragraph: none goes under 7 pt on A6, whatever its own attribute says
                const size = parseFloat(getComputedStyle(element).fontSize)
                if (size < (floor * width) / 100 - 0.05)
                  out.push(
                    'font ' +
                      ((size / width) * 100).toFixed(2) +
                      'cqw < ' +
                      floor +
                      ' : ' +
                      element.textContent?.slice(0, 30),
                  )
              }
              for (const link of root.querySelectorAll<HTMLElement>(
                '[class*="invLink"], [class*="esLink"]',
              )) {
                const size = parseFloat(getComputedStyle(link).fontSize)
                if (size < (floors.link * width) / 100 - 0.05)
                  out.push('link font ' + ((size / width) * 100).toFixed(2) + 'cqw')
                if (clipped(link)) out.push('link clipped')
              }
              for (const qr of root.querySelectorAll('svg[role="img"]'))
                if (clipped(qr)) out.push('QR clipped')
              for (const text of root.querySelectorAll<HTMLElement>('[data-fit]')) {
                if (clipped(text)) out.push('clipped: ' + text.textContent?.slice(0, 30))
                // Content that spills out of its box and is not marked as clipped by the fit is lost.
                if (
                  (text.tagName === 'P' || /svNote/.test(text.className)) &&
                  text.scrollHeight > text.clientHeight + 2 &&
                  text.dataset['clamped'] === undefined
                )
                  out.push('overflowing: ' + text.textContent?.slice(0, 30))
              }
              // The line saying the rest is on the page is the size of the link line, on a thumbnail as well.
              const more = root.querySelector('[class*="esMore"]')
              if (more !== null) {
                const ratio = (parseFloat(getComputedStyle(more).fontSize) / width) * 100
                if (ratio < 2.2 || ratio > 3.5)
                  out.push('the rest-on-the-page line is ' + ratio.toFixed(2) + ' cqw')
              }
              // The garland's title starts under the polaroid, not on it.
              const title = root.querySelector('h2')
              const prints = [...root.querySelectorAll('rect[class*="glPrint"]')]
              if (title !== null && prints.length > 0) {
                const lowest = Math.max(
                  ...prints.map((print) => print.getBoundingClientRect().bottom),
                )
                if (title.getBoundingClientRect().top < lowest - 0.5)
                  out.push('the title overlaps the polaroid')
              }
              // The hours on a boarding pass are set in the sans face: a space is a space.
              const code = root.querySelector('[class*="bpCodes"]')
              if (code !== null && /mono|plex/i.test(getComputedStyle(code).fontFamily)) {
                out.push('the hours are set in a monospace face')
              }
              return out
            },
            { link: FLOOR_LINK_CQW, word: FLOOR_WORD_CQW },
          )
        // The big card of the card's screen, then the card the paper carries (the sheet of Partager).
        expect(await measure(card), design.id + ' ' + language).toEqual([])
        await openShare(host)
        const printed = host.locator('[data-format]:not([data-single]) [data-print-card]').first()
        expect(await measure(printed), design.id + ' ' + language + ' (the sheet)').toEqual([])
        await backToCard(host)
      }
    },
  )
}

test('on another tab, or while locked, Ctrl+P prints the page as it is, not a headless remainder', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'carte-verrouillee', name: 'Léa fête ses 40 ans' })
  const panel = host.getByRole('region', { name: text.sharePanelTitle })

  // Locked: nothing is saved, so the formats are empty and say why.
  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=partage`))
  await expect(host.getByText(text.locked)).toBeVisible()
  await host.emulateMedia({ media: 'print' })
  await expect(panel).toBeVisible()
  await expect(host.getByRole('tablist')).toBeVisible()
  await expect(host.getByText(text.locked)).toBeVisible()

  // The image tab of a switched-on invitation.
  await host.emulateMedia({ media: 'screen' })
  const headers = await csrfHeaders(host.request, app)
  const saved = await host.request.put(app.url(`/api/events/${event.slug}/guest-invite`), {
    headers,
    data: { startsAt: '2027-12-11T18:00:00Z', timeZone: 'Europe/Paris', language: 'fr' },
  })
  expect(saved.status()).toBe(200)
  const enabled = await host.request.post(
    app.url(`/api/events/${event.slug}/guest-invite/enable`),
    { headers, data: {} },
  )
  expect(enabled.status()).toBe(200)
  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=partage`))
  await host.getByRole('tab', { name: text.tabImage }).click()
  await expect(host.locator('[data-format]')).toHaveCount(0)
  await host.emulateMedia({ media: 'print' })
  await expect(panel).toBeVisible()
  await expect(host.getByRole('tablist')).toBeVisible()
})

/** The size in PDF points of each page the browser would print, with the page's own @page rules. */
const pagesOf = async (page: Page): Promise<readonly (readonly [number, number])[]> => {
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1')
  const boxes = [...pdf.matchAll(/\/Type\s*\/Page\b(?!s)[\s\S]*?\/MediaBox\s*\[([^\]]+)\]/g)]
  return boxes.map((box) => {
    const [, , width, height] = (box[1] ?? '').trim().split(/\s+/).map(Number)
    return [width ?? 0, height ?? 0] as const
  })
}
