import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { TestApp } from './startTestApp'
import { aPhoto } from './media'

/**
 * Joining and uploading, through the real pages.
 *
 * Extracted because six journeys need it and each inlining it would be six places to
 * update when a label changes. Not extracted further: a helper that hid *which*
 * assertions a journey makes would defeat the point of the journey.
 */

export interface JoinAndUploadOptions {
  readonly displayName?: string
  readonly caption?: string
  /** A path from `./media`. Defaults to an ordinary landscape photo. */
  readonly file?: string
}

/**
 * Joins the event and sends one photo, leaving the page on the upload screen with the
 * queue row confirmed as sent.
 *
 * Waits on the row's `data-state` rather than on a timeout: the upload crosses a real
 * multipart request, `sharp`, and a database write, and how long that takes is not
 * something a test should guess at.
 */
export const joinAndUpload = async (
  page: Page,
  app: TestApp,
  joinCode: string,
  options: JoinAndUploadOptions = {},
): Promise<void> => {
  await page.goto(app.url(`/join/${joinCode}`))

  if (options.displayName !== undefined) {
    await page.getByLabel(/Votre prénom/i).fill(options.displayName)
  }
  await page.getByRole('button', { name: /Rejoindre/i }).click()
  await page.waitForURL(/\/e\/[^/]+\/upload/)

  const file = options.file ?? (await aPhoto('journey', 1200, 900))
  await page.getByTestId('photo-input').setInputFiles(file)

  if (options.caption !== undefined) {
    await page.getByLabel(/Légende/i).fill(options.caption)
  }

  await page.getByRole('button', { name: /Envoyer/i }).click()
  await expect(page.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')
}
