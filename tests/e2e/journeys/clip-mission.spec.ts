import { enterJoinName, expect, test, wallUrl } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { aClip, hasEncoder } from '../fixtures/media'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A video clip filed under a mission, through a real multipart upload, a real queue and a
 * real transcode.
 *
 * What no cheaper ring can answer: the mission chosen when the clip was picked survives the
 * job row (migration 027), is read back by the worker that writes the photograph minutes
 * later, and then counts on the wall and labels the row in "Vos envois". The guest changes
 * the selection after picking, which is the per-item rule: the clip stays on the first.
 *
 * Skips, loudly, where no encoder exists, for the reason `video-clip.spec.ts` gives.
 */
test.skip(
  () => !hasEncoder(),
  'no ffmpeg on this machine: a clip fixture cannot be built (CI has ffmpeg-static)',
)

test('a clip stays on the mission selected when it was picked, and counts for it', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'clip-missions', name: 'Camille & Sacha' })

  await host.goto(app.url(`/admin/events/${event.slug}`))
  for (const prompt of ['un selfie avec les mariés', 'la piste de danse']) {
    await host.getByLabel('Consigne').fill(prompt)
    await host.getByRole('button', { name: 'Ajouter la mission' }).click()
    await expect(host.getByRole('listitem').filter({ hasText: prompt })).toBeVisible()
  }

  await guest.goto(app.url(`/join/${event.joinCode}`))
  await enterJoinName(guest, 'Léa')
  await guest.getByRole('button', { name: /Rejoindre/i }).click()
  await guest.waitForURL(/\/e\/[^/]+\/upload/)
  await passPrivacyNotice(guest)

  await guest.getByRole('button', { name: 'un selfie avec les mariés' }).click()
  await guest.getByTestId('clip-input').setInputFiles(await aClip('mission-clip', 3))
  // Selected after the pick: this must not move the clip.
  await guest.getByRole('button', { name: 'la piste de danse' }).click()
  await guest.getByRole('button', { name: fr.upload.clipSend }).click()
  await expect(guest.getByTestId('clip-state')).toHaveAttribute('data-stage', 'done')

  // "Vos envois": the clip's row says which mission it was filed under.
  await expect(guest.getByText(fr.upload.mineMission('un selfie avec les mariés'))).toBeVisible()
  await expect(guest.getByText(fr.upload.mineMission('la piste de danse'))).toHaveCount(0)

  // Moderation, then the wall: only the mission it was picked for is answered.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  const card = host.getByTestId('moderation-card')
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: /Publier/i }).click()
  await expect(card).toHaveCount(0)

  await projector.goto(wallUrl(app, event.slug))
  const answered = projector.getByRole('listitem').filter({ hasText: 'un selfie avec les mariés' })
  await expect(answered).toHaveAttribute('data-mission-answered', 'true')
  const other = projector.getByRole('listitem').filter({ hasText: 'la piste de danse' })
  await expect(other).toHaveAttribute('data-mission-answered', 'false')
})
