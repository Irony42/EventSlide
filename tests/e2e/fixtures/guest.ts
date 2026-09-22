import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { TestApp } from './startTestApp'
import { aPhoto } from './media'
import { SUPPORTED_LOCALES } from '../../../web/src/lib/i18n/locale'
import { TRANSLATIONS } from '../../../web/src/lib/i18n/translations'

/**
 * Joining and uploading, through the real pages.
 *
 * Extracted because six journeys need it and each inlining it would be six places to
 * update when a label changes. Not extracted further: a helper that hid *which*
 * assertions a journey makes would defeat the point of the journey.
 */

/** "J’ai compris" in any of the five languages, so a spec in another locale can use this. */
const ACKNOWLEDGE = new RegExp(
  SUPPORTED_LOCALES.map((locale) => TRANSLATIONS[locale].upload.noticeAcknowledge).join('|'),
  'u',
)

/**
 * Gets a guest past the privacy notice (roadmap §5.1) and onto the picker.
 *
 * The upload screen offers nothing that sends until this device has read the notice in
 * force, so every journey that uploads through the page meets it — once per device, which
 * is why this asks whether the card is there rather than assuming: a spec that joins twice
 * from one phone meets it on the first join only. What the notice says, and when it comes
 * back, is `privacy-notice.spec.ts`'s to assert rather than every journey's.
 *
 * Waits on the composer first, because the card and the picker render in the same commit
 * from the session the join wrote — so once the composer is on screen, whether the card is
 * there is already decided and the count below is not a race.
 *
 * And waits for the server to have **recorded** the acknowledgement, not only for the
 * picker: the screen hands the picker over at the tap, before the request answers, so a
 * spec that went offline straight after would otherwise race the request it cut off.
 */
export const passPrivacyNotice = async (page: Page): Promise<void> => {
  await expect(page.getByTestId('upload-composer')).toBeVisible()
  const notice = page.getByTestId('privacy-notice')
  if ((await notice.count()) > 0) {
    const recorded = page.waitForResponse(
      (response) =>
        response.url().endsWith('/privacy-notice/acknowledgement') && response.status() === 200,
    )
    await notice.getByRole('button', { name: ACKNOWLEDGE }).click()
    await recorded
  }
  await expect(page.getByTestId('photo-input')).toBeAttached()
}

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
  await passPrivacyNotice(page)

  const file = options.file ?? (await aPhoto('journey', 1200, 900))
  await page.getByTestId('photo-input').setInputFiles(file)

  if (options.caption !== undefined) {
    await page.getByLabel(/Légende/i).fill(options.caption)
  }

  await page.getByRole('button', { name: /Envoyer/i }).click()
  await expect(page.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')
}
