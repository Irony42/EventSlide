import { expect, test } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'
import type { Page } from '@playwright/test'

/**
 * Roadmap 5.1, end to end: what happens to a photo, read once before the first one.
 *
 * It earns ring 6 because the promise crosses two surfaces and a real cookie. The retention
 * a guest reads is the one a host chose on a laptop a minute earlier; "once per device" is
 * a property of the `es_guest` cookie and the guest's row, which only a real browser
 * holding a real cookie across a closed tab can show; and "again when the host changes it"
 * is the host's form reaching a phone that joined before the change. Every ring below
 * this one fakes at least one of those three.
 *
 * What the notice says for every combination of settings is ring 1 and ring 5. This walks
 * the one journey a guest actually has.
 */

/** The host's settings form, as a host uses it. */
const setRetention = async (host: Page, slug: string, option: string): Promise<void> => {
  await host.goto(`/admin/events/${slug}/settings`)
  await host.getByLabel(fr.admin.retention).selectOption({ label: option })
  // Exact, because the schedule below the settings has its own "Enregistrer l’horaire".
  await host.getByRole('button', { name: fr.app.save, exact: true }).click()
  await expect(host.getByText(fr.admin.settingsSaved)).toBeVisible()
}

const join = async (page: Page, joinCode: string): Promise<void> => {
  await page.goto(`/join/${joinCode}`)
  await page.getByRole('button', { name: fr.join.submit }).click()
  await page.waitForURL(/\/e\/[^/]+\/upload/)
}

test('a guest reads what happens to a photo before the first one, once, and again after the host changes it @smoke', async ({
  app,
  surfaces,
}) => {
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'notice-mariage', name: 'Camille & Sacha' })
  await setRetention(host, event.slug, fr.admin.retentionDays(30))

  // --- The phone: the notice stands where the picker will be, saying what the host set.
  await join(guest, event.joinCode)
  const notice = guest.getByRole('region', { name: fr.upload.noticeTitle })
  await expect(notice).toBeVisible()
  await expect(notice.getByText(fr.upload.noticeRetentionDays(30))).toBeVisible()
  await expect(notice.getByText(fr.upload.noticePublication.afterReview)).toBeVisible()
  // Nothing that sends is offered yet — and nothing a guest came to look at is hidden.
  await expect(guest.getByTestId('photo-input')).toHaveCount(0)
  await expect(guest.getByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
  await expect(guest.getByText(fr.upload.mineEmpty)).toBeVisible()

  const recorded = guest.waitForResponse((response) =>
    response.url().endsWith('/privacy-notice/acknowledgement'),
  )
  await notice.getByRole('button', { name: fr.upload.noticeAcknowledge }).click()
  expect((await recorded).status()).toBe(200)

  // --- Read, so the picker is there, focused, and an upload goes through.
  await expect(guest.getByTestId('photo-input')).toBeFocused()
  await guest.getByTestId('photo-input').setInputFiles(await aPhoto('notice', 1200, 900))
  await guest.getByRole('button', { name: fr.upload.sendCount(1) }).click()
  await expect(guest.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')

  // --- Not shown again to this device: not on a reload, and not in a new tab that
  // re-scans the code — the tab's session is gone, the device cookie is not.
  await guest.reload()
  await expect(guest.getByTestId('photo-input')).toBeAttached()
  await expect(guest.getByTestId('privacy-notice')).toHaveCount(0)

  const newTab = await guest.context().newPage()
  await join(newTab, event.joinCode)
  await expect(newTab.getByTestId('photo-input')).toBeAttached()
  await expect(newTab.getByTestId('privacy-notice')).toHaveCount(0)
  await newTab.close()

  // --- Still reachable afterwards, from the header.
  await guest.getByRole('button', { name: fr.upload.noticeLink }).click()
  const reopened = guest.getByRole('dialog', { name: fr.upload.noticeLink })
  await expect(reopened.getByText(fr.upload.noticeRetentionDays(30))).toBeVisible()
  // Exact: the corner button is "Fermer la fenêtre", this is the one under the thumb.
  await reopened.getByRole('button', { name: fr.app.close, exact: true }).click()
  await expect(reopened).toBeHidden()

  // --- The host now keeps the album forever. What the guest read is no longer what
  // happens to their next photo, so the notice is back before it — saying why.
  await setRetention(host, event.slug, fr.admin.retentionNever)
  await guest.reload()

  const changed = guest.getByRole('region', { name: fr.upload.noticeChangedTitle })
  await expect(changed).toBeVisible()
  await expect(changed.getByText(fr.upload.noticeRetentionNone)).toBeVisible()
  await expect(guest.getByTestId('photo-input')).toHaveCount(0)
  // The photo already sent is still listed: the notice gates sending, not looking.
  await expect(guest.getByText(fr.upload.statusPending)).toBeVisible()

  await changed.getByRole('button', { name: fr.upload.noticeAcknowledge }).click()
  await expect(guest.getByTestId('photo-input')).toBeAttached()
})

test('a guest of an event that publishes on arrival is told so, and not offered a delete they do not have', async ({
  app,
  surfaces,
}) => {
  // The case a notice written as prose gets wrong twice. The server stores every photo
  // published, so "checked before the screen" would be false — and a guest can only take
  // back a photo that is not on the wall, so a promised self-delete window would be a
  // button the server refuses.
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'notice-direct', name: 'Soirée directe' })
  await host.goto(`/admin/events/${event.slug}/settings`)
  await host.getByRole('radio', { name: fr.admin.moderationAuto }).check()
  await host.getByRole('button', { name: fr.app.save, exact: true }).click()
  await expect(host.getByText(fr.admin.settingsSaved)).toBeVisible()

  await join(guest, event.joinCode)

  const notice = guest.getByRole('region', { name: fr.upload.noticeTitle })
  await expect(notice.getByText(fr.upload.noticePublication.immediate)).toBeVisible()
  await expect(notice.getByText(fr.upload.noticeRemovalAskHost)).toBeVisible()
  await expect(guest.getByText(fr.upload.introImmediate)).toBeVisible()
})
