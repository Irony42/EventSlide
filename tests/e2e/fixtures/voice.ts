import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The guest's voice message, driven through the real recorder (spec 25).
 *
 * Chromium's own fake capture device stands in for the microphone: `--use-fake-device-for-media-stream`
 * gives the page's capture request a stream (a beep), and `--use-fake-ui-for-media-stream` answers the permission
 * prompt, so the real `MediaRecorder` produces a real WebM/Opus file. A spec that wants it says
 * `test.use({ launchOptions: { args: FAKE_MICROPHONE } })`, which is why this is not a project of
 * its own: nothing else in the suite asks for a microphone, and a flag on a browser nobody records
 * with changes nothing.
 */
export const FAKE_MICROPHONE: string[] = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
]

/** Opens the recorder from the guestbook card, the guest having passed the notice. */
export const openRecorder = async (guest: Page): Promise<void> => {
  await guest.getByRole('button', { name: fr.guestbookVoice.open }).click()
  await expect(guest.getByRole('button', { name: fr.guestbookVoice.record })).toBeVisible()
}

/**
 * Records for `seconds` of the phone's own clock and stops.
 *
 * The wait is on the clock the screen shows, never on a timeout: the recorder's timer is what the
 * guest watches, and it is what decides when a take is long enough.
 */
export const recordTake = async (guest: Page, seconds: number): Promise<void> => {
  await guest.getByRole('button', { name: fr.guestbookVoice.record }).click()
  const reached = `0:${String(seconds).padStart(2, '0')}`
  await expect(guest.getByText(new RegExp(`^${reached}(\\.\\d+)? / `))).toBeVisible({
    timeout: 15_000,
  })
  await guest.getByRole('button', { name: fr.guestbookVoice.stop }).click()
  await expect(guest.getByRole('button', { name: fr.guestbookVoice.listen })).toBeVisible()
}

/** Sends the take on screen and waits for the answer the card gives. */
export const sendTake = async (guest: Page, caption?: string): Promise<void> => {
  if (caption !== undefined) await guest.getByLabel(fr.guestbookVoice.captionLabel).fill(caption)
  await guest.getByRole('button', { name: fr.guestbookVoice.send }).click()
}
