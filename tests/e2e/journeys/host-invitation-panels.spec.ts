import { expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { closePanel, openReplies, repliesPanel, sharePanel } from '../fixtures/invitationPanels'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's Invitations page, card first: the card's column on the left, and two doors that open
 * a panel **in place of that column**. What no cheaper ring can answer is what a real layout does:
 * the preview stays in view while the left column scrolls, the page itself does not scroll, the
 * address says which panel is open (a reload and Back return to it), and the preview follows the
 * panel.
 */

const text = fr.guestInvite.host
const asked = fr.rsvp.host

/** The layouts that only a laptop has (a fixed-height workspace) are not asked of a phone. */
const laptopOnly = (projectName: string) => {
  test.skip(projectName !== 'chromium-desktop', 'the laptop layout')
}

test('a door opens its panel in place of the column, the address says so, and the preview follows', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event } = await invitedHost(host, app, 'panneaux-ouverture')
  const door = (name: string) => host.getByRole('button', { name: new RegExp(`^${name}`) })
  const form = host.getByRole('form', { name: text.formTitle })
  const preview = host.getByTestId('invite-preview')

  // --- The card: its column, two doors that say what they hold, the card on the preview.
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  await expect(form).toBeVisible()
  await expect(door(asked.title)).toContainText(asked.stateOff)
  await expect(door(text.sharePanelTitle)).toContainText(text.entryShareSummary)
  await expect(preview.locator('[data-format]')).toBeVisible()

  // --- The replies: the column is gone, the preview is the guest's page, the address has it.
  await door(asked.title).click()
  await expect(host).toHaveURL(/[?&]panel=reponses/)
  await expect(repliesPanel(host)).toBeVisible()
  await expect(form).toHaveCount(0)
  await expect(preview.getByRole('group', { name: text.guestPreviewLabel })).toBeVisible()
  await expect(
    repliesPanel(host).getByRole('heading', { level: 2, name: asked.title }),
  ).toBeFocused()

  // A reload returns to the same screen, and Back to the card.
  await host.reload()
  await expect(repliesPanel(host)).toBeVisible()
  await host.goBack()
  await expect(form).toBeVisible()
  await expect(preview.locator('[data-format]')).toBeVisible()

  // --- Sharing: the format is in the address too, and the preview shows it.
  await door(text.sharePanelTitle).click()
  await expect(host).toHaveURL(/[?&]panel=partage/)
  await expect(sharePanel(host)).toBeVisible()
  await sharePanel(host).getByRole('tab', { name: text.tabEmail }).click()
  await expect(host).toHaveURL(/[?&]format=email/)
  await expect(
    preview.getByRole('region', { name: fr.guestInvite.email.previewLabel }),
  ).toBeVisible()
  await host.reload()
  await expect(sharePanel(host).getByRole('tab', { name: text.tabEmail })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // --- Escape closes it and the focus goes back to its door.
  await host.keyboard.press('Escape')
  await expect(form).toBeVisible()
  await expect(host).not.toHaveURL(/panel=/)
  await expect(door(text.sharePanelTitle)).toBeFocused()

  // --- « Fermer » does the same.
  await door(asked.title).click()
  await repliesPanel(host).getByRole('button', { name: fr.app.close, exact: true }).click()
  await expect(form).toBeVisible()
  await expect(door(asked.title)).toBeFocused()
})

test('the preview stays in view while the column or a panel scrolls, and the page does not scroll', async ({
  app,
  surfaces,
}, testInfo) => {
  laptopOnly(testInfo.project.name)
  const { host } = surfaces
  const { event } = await invitedHost(host, app, 'panneaux-defilement')
  await host.setViewportSize({ width: 1440, height: 760 })
  const preview = host.getByTestId('invite-preview')

  /** Scrolls the nearest scrolling ancestor of the element, as far as it goes. */
  const scrollDown = (target: ReturnType<typeof host.locator>) =>
    target.evaluate((element) => {
      let scroller: HTMLElement | null = element.parentElement
      while (scroller !== null && getComputedStyle(scroller).overflowY !== 'auto') {
        scroller = scroller.parentElement
      }
      if (scroller === null) return false
      scroller.scrollTop = scroller.scrollHeight
      return scroller.scrollTop > 0
    })
  const pageScroll = () =>
    host.evaluate(() => ({
      scrolled: window.scrollY,
      overflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }))

  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  await expect(preview).toBeVisible()
  const before = await preview.boundingBox()

  // --- The card's column is longer than the window: it scrolls, the preview does not move.
  expect(await scrollDown(host.getByRole('form', { name: text.formTitle }))).toBe(true)
  await expect(preview).toBeInViewport({ ratio: 1 })
  expect(await preview.boundingBox()).toEqual(before)
  expect((await pageScroll()).scrolled).toBe(0)

  // --- The replies' panel too, with its footer where the save indicator is.
  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=reponses`))
  await host.getByRole('checkbox', { name: asked.askLabel }).check()
  for (const group of [asked.groupMeals, asked.questionsTitle, asked.momentsTitle]) {
    await host.locator('summary', { hasText: group }).click()
  }
  expect(
    await scrollDown(host.getByRole('heading', { level: 3, name: asked.essentialsTitle })),
  ).toBe(true)
  await expect(preview).toBeInViewport({ ratio: 1 })
  expect(await preview.boundingBox()).toEqual(before)
  await expect(repliesPanel(host).locator('[data-panel-footer]')).toBeInViewport()
  expect((await pageScroll()).scrolled).toBe(0)
})

test('the colour is one row of six and a "+6": the rest, and a free colour, are in a popover that Escape closes', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event } = await invitedHost(host, app, 'panneaux-couleur')
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  const row = host.getByRole('radiogroup', { name: new RegExp(fr.admin.printKitColour) })
  const more = host.getByRole('button', { name: text.colourMore })

  await expect(row.getByRole('radio')).toHaveCount(6)
  await expect(more).toHaveText('+6')

  await more.click()
  const all = host.getByRole('radiogroup', { name: text.colourAll })
  await expect(all.getByRole('radio')).toHaveCount(12)
  await host.keyboard.press('Escape')
  await expect(all).toHaveCount(0)
  await expect(more).toBeFocused()

  // A colour of the popover is chosen, named, and kept on the row after a reload.
  await more.click()
  await all.getByRole('radio', { name: fr.admin.printSwatchNames.charcoal }).click()
  await expect(all).toHaveCount(0)
  await expect(row.getByRole('radio', { checked: true })).toHaveAccessibleName(
    fr.admin.printSwatchNames.charcoal,
  )
  await host.reload()
  await expect(row.getByRole('radio', { checked: true })).toHaveAccessibleName(
    fr.admin.printSwatchNames.charcoal,
  )
})

test('closing a panel the host opened is one step back: Back does not reopen it', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event } = await invitedHost(host, app, 'panneaux-retour')
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))

  await openReplies(host)
  await closePanel(host)
  await expect(host).not.toHaveURL(/panel=/)
  await host.goBack()

  await expect(host).not.toHaveURL(/panel=/)
  await expect(repliesPanel(host)).toHaveCount(0)
})

test('on a phone the preview stays pinned while the panel scrolls, and the footer stays in reach', async ({
  app,
  surfaces,
}, testInfo) => {
  test.skip(testInfo.project.name === 'chromium-desktop', 'the phone layout')
  const { host } = surfaces
  const { event } = await invitedHost(host, app, 'panneaux-telephone')
  await host.setViewportSize({ width: 390, height: 780 })
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  const preview = host.getByTestId('invite-preview')

  // The card's own screen: the pane is pinned while the column scrolls.
  await host.evaluate(() => window.scrollBy(0, 700))
  await expect(preview).toBeInViewport()
  await host.evaluate(() => window.scrollTo(0, 0))

  // A panel: the same, and its footer is under the thumb.
  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=reponses`))
  await host.getByRole('checkbox', { name: asked.askLabel }).check()
  await host.locator('summary', { hasText: asked.groupMeals }).click()
  await host.evaluate(() => window.scrollBy(0, 900))
  await expect(preview).toBeInViewport()
  await expect(repliesPanel(host).locator('[data-panel-footer]')).toBeInViewport()
  const overflow = await host.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the colour popover is brought into view in the scrolling column of a 1280×720 laptop', async ({
  app,
  surfaces,
}, testInfo) => {
  laptopOnly(testInfo.project.name)
  const { host } = surfaces
  const { event } = await invitedHost(host, app, 'panneaux-popover')
  await host.setViewportSize({ width: 1280, height: 720 })
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))

  await host.getByRole('button', { name: text.colourMore }).click()

  await expect(host.locator('[data-popover]')).toBeInViewport({ ratio: 1 })
  // Tab past it: it closes.
  await host.keyboard.press('Tab')
  await host.keyboard.press('Tab')
  await host.keyboard.press('Tab')
  await host.keyboard.press('Tab')
  await expect(host.locator('[data-popover]')).toHaveCount(0)
})

test('the workspace is sized from the real head: the preview is in the window with an inactive invitation too', async ({
  app,
  surfaces,
}, testInfo) => {
  laptopOnly(testInfo.project.name)
  const { host } = surfaces
  // A plain event: no invitation yet, so the link's bar has its longest sentence.
  const event = await app.seedEvent({ slug: 'panneaux-inactive', name: 'Léa fête ses 40 ans' })
  const inWindow = async (width: number, height: number) => {
    await host.setViewportSize({ width, height })
    await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
    const box = await host.getByTestId('invite-preview').boundingBox()
    expect(box, `${width}×${height}`).not.toBeNull()
    expect((box?.y ?? 0) + (box?.height ?? 0), `${width}×${height}`).toBeLessThanOrEqual(height)
  }

  await inWindow(1280, 720)
  await inWindow(1000, 700)
  await inWindow(1440, 900)
})
