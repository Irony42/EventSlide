import { expect, joinAsGuest, test } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * What WebKit is asked about voice messages: only whether the button is there when the
 * engine can record, and absent when it cannot, with no exception either way (spec 25).
 *
 * WebKit offers no dependable fake microphone, so this file does not record and does not
 * pretend to. Recording on a real iPhone (MP4/AAC from `MediaRecorder`, the preview that may
 * not play, the permission sheet) is a manual check listed in section 16 of the spec.
 */
test.beforeEach(({ browserName }, info) => {
  test.skip(
    browserName !== 'webkit' || info.project.name !== 'webkit-mobile',
    'the detection is WebKit’s question; Chromium records in voice-guestbook.spec.ts',
  )
})

test('the button is there exactly when this engine can record, and nothing throws', async ({
  app,
  surfaces,
}) => {
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'voix-webkit', template: 'wedding' })
  const errors: string[] = []
  guest.on('pageerror', (error) => errors.push(error.message))

  await joinAsGuest(guest, app, event.joinCode, 'Léa')
  await passPrivacyNotice(guest)
  await expect(guest.getByRole('button', { name: fr.guestbook.open })).toBeVisible()

  const canRecord = await guest.evaluate(
    () =>
      window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined' &&
      [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ].some((type) => MediaRecorder.isTypeSupported(type)),
  )
  await expect(guest.getByRole('button', { name: fr.guestbookVoice.open })).toHaveCount(
    canRecord ? 1 : 0,
  )
  expect(errors).toEqual([])
})
