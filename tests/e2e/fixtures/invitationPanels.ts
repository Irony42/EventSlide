import { expect, type Locator, type Page } from '@playwright/test'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's Invitations page is the card first: the replies and the formats live in two panels
 * that take the place of the card's column. These open one by its door, whatever is on screen,
 * and say where the panel is.
 */
const text = fr.guestInvite.host

export const sharePanel = (page: Page): Locator =>
  page.getByRole('region', { name: text.sharePanelTitle })
export const repliesPanel = (page: Page): Locator =>
  page.getByRole('region', { name: fr.rsvp.host.title })

const closeButton = (page: Page): Locator =>
  page.getByRole('button', { name: fr.app.close, exact: true })

const open = async (page: Page, door: RegExp, panel: Locator): Promise<Locator> => {
  if (!(await panel.isVisible())) {
    if (await closeButton(page).isVisible()) await closeButton(page).click()
    await page.getByRole('button', { name: door }).click()
  }
  await expect(panel).toBeVisible()
  return panel
}

/** Opens « Partager et imprimer » (and the card's column goes away). */
export const openShare = (page: Page): Promise<Locator> =>
  open(page, new RegExp(`^${text.sharePanelTitle}`), sharePanel(page))

/** Opens « Réponses des invités ». */
export const openReplies = (page: Page): Promise<Locator> =>
  open(page, new RegExp(`^${fr.rsvp.host.title}`), repliesPanel(page))

/** Back to the card's column. */
export const backToCard = async (page: Page): Promise<void> => {
  if (await closeButton(page).isVisible()) await closeButton(page).click()
  await expect(page.getByRole('form', { name: text.formTitle })).toBeVisible()
}
