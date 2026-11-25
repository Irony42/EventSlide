import { expect, type Locator, type Page } from '@playwright/test'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's Invitations page is the card first: the replies and the formats live in two panels
 * that take the place of the card's column. These open one by its door **from the card's screen**
 * (and say so if it is not on it), and close the one that is open.
 */
const text = fr.guestInvite.host

export const sharePanel = (page: Page): Locator =>
  page.getByRole('region', { name: text.sharePanelTitle })
export const repliesPanel = (page: Page): Locator =>
  page.getByRole('region', { name: fr.rsvp.host.title })

/** The panel that is open, whichever it is. */
const openPanel = (page: Page): Locator => page.locator('section[id^="invite-panel-"]')

const door = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${name}`) })

const open = async (page: Page, name: string, panel: Locator): Promise<Locator> => {
  await door(page, name).click()
  await expect(panel).toBeVisible()
  // The host opened it: its title has the focus.
  await expect(panel.getByRole('heading', { level: 2 })).toBeFocused()
  return panel
}

/** Opens « Partager et imprimer » from the card's screen (the card's column goes away). */
export const openShare = (page: Page): Promise<Locator> =>
  open(page, text.sharePanelTitle, sharePanel(page))

/** Opens « Réponses des invités » from the card's screen. */
export const openReplies = (page: Page): Promise<Locator> =>
  open(page, fr.rsvp.host.title, repliesPanel(page))

/** Closes the open panel with its own « Fermer » and waits for the card's column. */
export const closePanel = async (page: Page): Promise<void> => {
  await openPanel(page).getByRole('button', { name: fr.app.close, exact: true }).click()
  await expect(page.getByRole('form', { name: text.formTitle })).toBeVisible()
}

/** Back to the card's column; nothing to do when it is already there. */
export const backToCard = async (page: Page): Promise<void> => {
  if (await openPanel(page).isVisible()) await closePanel(page)
  await expect(page.getByRole('form', { name: text.formTitle })).toBeVisible()
}

/**
 * Chooses a card design by its tile, as a host does, and waits for the choice to hold.
 *
 * The radio inside the tile is a 1 px clipped box (it stays focusable and announced while the tile
 * shows the state), so a forced `check()` clicks one pixel at the tile's corner, and on the card-first
 * page that pixel is sometimes under a sticky element: the click lands elsewhere and nothing is
 * chosen (`Clicking the checkbox did not change its state`, 1 run in 15 locally). Clicking the tile
 * goes through Playwright's actionability checks, which retry until nothing covers the tile.
 */
export const chooseDesign = async (page: Page, name: string): Promise<void> => {
  const radio = page.getByRole('radio', { name, exact: true })
  await page.locator('label').filter({ has: radio }).click()
  await expect(radio).toBeChecked()
}
