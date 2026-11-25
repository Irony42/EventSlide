import { expect, type Page } from '@playwright/test'

/**
 * The host's settings page saves by itself: a change is queued and sent as one
 * `PATCH …/settings` after a short stillness. These helpers wait for that request
 * instead of for a Save button that no longer exists.
 */

/** A section's exact title, as it names the toggle button inside its `<h2>`. */
export type SettingsSection =
  'Invités' | 'Livre d’or' | 'Appareil jetable' | 'Écran de la salle' | 'Horaires et conservation'

/** Opens one section (the others close); its controls are `hidden` until then. */
export const openSettingsSection = async (page: Page, name: SettingsSection): Promise<void> => {
  const toggle = page.getByRole('button', { name, exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

/**
 * The appearance page of an event (`/appearance`), which holds what the « Apparence » section of the
 * settings page used to: images, ambiance, colour, welcome message and the details of the room's screen.
 * It saves by itself too, so `saved` waits on it the same way.
 */
export const openAppearance = async (page: Page, url: string): Promise<void> => {
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Apparence' })).toBeVisible()
}

/** Chooses an ambiance by its card (a radio named after it), as a host does. */
export const chooseAmbianceCard = (page: Page, name: string) =>
  page.getByRole('radio', { name, exact: true }).check()

/** Opens the folded details of the room's screen, where the frame and the face are chosen. */
export const openScreenDetails = async (page: Page): Promise<void> => {
  const details = page.locator('details', { hasText: 'Détails de l’écran de la salle' })
  if ((await details.getAttribute('open')) === null) {
    await details.getByText('Détails de l’écran de la salle').click()
  }
  await expect(details).toHaveAttribute('open', '')
}

/**
 * Runs `action` and resolves once the autosave PATCH of the settings has answered OK and the
 * status line says nothing is left in flight (several changes made in a burst are one request,
 * or two: the line only says saved once the last has landed).
 */
export const saved = async (page: Page, action: () => Promise<unknown>): Promise<void> => {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/settings') && r.request().method() === 'PATCH',
  )
  // A failing action must not leave this promise rejected with nobody listening.
  response.catch(() => undefined)
  await action()
  expect((await response).ok()).toBe(true)
  await expect(page.locator('[data-state="saved"]')).toBeVisible()
}
