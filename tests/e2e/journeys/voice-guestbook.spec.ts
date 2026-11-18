import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'
import { csrfHeaders, expect, joinAsGuest, signInAsHost, test } from '../fixtures/app'
import { passPrivacyNotice } from '../fixtures/guest'
import { hasEncoder } from '../fixtures/media'
import { FAKE_MICROPHONE, openRecorder, recordTake, sendTake } from '../fixtures/voice'
import { readZip } from '../fixtures/zip'
import type { TestApp } from '../fixtures/startTestApp'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A guest leaves a voice message, and only the organiser ever hears it (spec 25).
 *
 * Everything cheaper is held one ring down: the states of a recording, the ceilings, the
 * refusals, the bytes of the transcode. What only real browsers on a real server can say is
 * what is here, and there are five things: a real `MediaRecorder` file crossing a real
 * multipart upload and a real ffmpeg; a real `<audio>` that asks for a range and is answered
 * `206`; the **wall that hears nothing** (no frame, no re-read, a page the browser itself
 * forbids the microphone); the secret that holds until "Ouvrir maintenant"; and a take that
 * fits a 375 px phone.
 *
 * Chromium on the phone project only, with a fake capture device (`fixtures/voice.ts`). WebKit has
 * no dependable fake microphone: `voice-detection.spec.ts` asserts only what it can. Recording on
 * a real iPhone is a manual check (spec 25, section 16), not a test pretended to be automatic.
 */
test.use({ launchOptions: { args: FAKE_MICROPHONE } })
test.beforeEach(({ browserName }, info) => {
  test.skip(
    browserName !== 'chromium' || info.project.name !== 'chromium-mobile',
    'the fake microphone is Chromium’s, and the guest is a phone',
  )
})
test.skip(() => !hasEncoder(), 'no ffmpeg on this machine: a recording cannot be transcoded')

/** Long enough to be a message, short to transcode. */
const TAKE_SECONDS = 3

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** The guest is on the upload screen with the notice read. */
const arrive = async (guest: Page, app: TestApp, joinCode: string): Promise<void> => {
  await joinAsGuest(guest, app, joinCode, 'Léa')
  await passPrivacyNotice(guest)
}

/** What the guest does: record, listen to the take, send. */
const leaveAMessage = async (
  guest: Page,
  caption: string,
  beforeSending: () => Promise<void> = async () => undefined,
): Promise<void> => {
  await openRecorder(guest)
  await recordTake(guest, TAKE_SECONDS)

  // Listening is a local copy, and the proof is that it plays: the clock of the element moves.
  await guest.getByRole('button', { name: fr.guestbookVoice.listen }).click()
  const preview = guest.locator('audio')
  await expect
    .poll(async () => preview.evaluate((element: HTMLAudioElement) => element.currentTime), {
      message: 'the take never played back',
    })
    .toBeGreaterThan(0)

  await beforeSending()
  await sendTake(guest, caption)
}

test('a wedding turns voice on, a guest leaves a message, the host hears it and the wall hears nothing', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({
    slug: 'mariage-voix',
    name: 'Camille & Sacha',
    template: 'wedding',
  })

  // The template is the only thing that switched it on.
  const settings = await host.request.get(app.url(`/api/events/${event.slug}`))
  expect(
    ((await settings.json()) as { settings: { guestbookVoice: { enabled: boolean } } }).settings
      .guestbookVoice.enabled,
  ).toBe(true)

  // --- The room: a stream that is open and a wall that is empty, watched from now on.
  await projector.addInitScript(() => {
    const frames: string[] = []
    const state = { frames, opened: 0 }
    ;(window as unknown as { __voiceWall: typeof state }).__voiceWall = state
    const Native = window.EventSource
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        this.addEventListener('open', () => {
          state.opened += 1
        })
        this.addEventListener('change', (message) => {
          frames.push((message as MessageEvent<string>).data)
        })
      }
    }
  })
  const wallReads: string[] = []
  projector.on('request', (request) => {
    if (new URL(request.url()).pathname === `/api/events/${event.slug}/wall`) {
      wallReads.push(request.url())
    }
  })
  await projector.goto(app.url(`/e/${event.slug}/display`))
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  await expect
    .poll(() =>
      projector.evaluate(
        () => (window as unknown as { __voiceWall: { opened: number } }).__voiceWall.opened,
      ),
    )
    .toBeGreaterThan(0)

  // --- Guest: the card offers the microphone because the event does.
  await arrive(guest, app, event.joinCode)
  // The wall opens with two reads of its own (the page, then the stream's first frame); what is
  // counted is what comes after, which the three seconds of recording leave well settled.
  let baselineReads = 0
  let baselineFrames = 0
  await leaveAMessage(guest, 'Tous mes vœux', async () => {
    baselineReads = wallReads.length
    baselineFrames = await projector.evaluate(
      () => (window as unknown as { __voiceWall: { frames: string[] } }).__voiceWall.frames.length,
    )
  })
  await expect(guest.getByText(fr.guestbookVoice.thanksManual)).toBeVisible()

  // "En traitement" while the box transcodes, then the guestbook's own word for a message waiting.
  await expect(guest.getByText(/Message vocal, 0:0[2-4]/)).toBeVisible()
  await expect(guest.getByText(fr.guestbook.statusPending)).toBeVisible({ timeout: 60_000 })

  // --- Host: a card with a real player, and the player is answered a range.
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host.getByRole('tab', { name: new RegExp(`^${fr.moderation.tabMessages}`) }).click()
  const player = host.getByLabel(/^Message vocal de Léa, 0:0[2-4]$/)
  await expect(player).toBeVisible()
  await expect(host.getByText('Tous mes vœux')).toBeVisible()
  // A voice is never hidden from the screen it never reaches.
  await expect(host.getByRole('button', { name: /retirer de l’écran|masquer/i })).toHaveCount(0)

  const ranged = host.waitForResponse(
    (response) =>
      /\/guestbook\/[^/]+\/voice$/.test(new URL(response.url()).pathname) &&
      response.status() === 206,
  )
  await player.evaluate((element: HTMLAudioElement) => element.play())
  const audio = await ranged
  expect(audio.headers()['content-type']).toBe('audio/mp4')
  await expect
    .poll(async () => player.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0)

  await host.getByRole('button', { name: fr.moderation.publishPhoto('Léa') }).click()
  // The guest's list reads the server again when the page is opened (nothing is pushed to a phone).
  await guest.reload()
  await expect(guest.getByText(fr.guestbookVoice.statusPublished)).toBeVisible()

  // --- The room heard nothing: no frame, no re-read, nothing on a wall that stayed empty.
  expect(
    await projector.evaluate(
      () => (window as unknown as { __voiceWall: { frames: string[] } }).__voiceWall.frames.length,
    ),
    'a frame reached the wall while a voice arrived, was processed and was decided',
  ).toBe(baselineFrames)
  expect(wallReads.length, 'the wall re-read its playlist for a voice').toBe(baselineReads)
  await expect(projector.getByTestId('wall-empty')).toBeVisible()
  await expect(projector.locator('audio')).toHaveCount(0)

  // --- The verified archive carries the recording, its manifest line and the guestbook.
  // The archive is asked of a closed evening, which also moves the wall: so the room is read first.
  const headers = await csrfHeaders(host.request, app)
  const closed = await host.request.post(app.url(`/api/events/${event.slug}/status`), {
    headers,
    data: { status: 'closed' },
  })
  expect(closed.status()).toBe(200)
  const asked = await host.request.post(app.url(`/api/events/${event.slug}/export`), { headers })
  expect(asked.status()).toBe(202)
  await expect
    .poll(
      async () => {
        const state = await host.request.get(app.url(`/api/events/${event.slug}/export`))
        return ((await state.json()) as { status: string }).status
      },
      { timeout: 60_000 },
    )
    .toBe('sealed')
  const zip = await host.request.get(app.url(`/api/events/${event.slug}/export.zip`))
  expect(zip.status()).toBe(200)
  const entries = readZip(await zip.body())
  const manifest = entries.find((entry) => entry.name.endsWith('MANIFEST.sha256'))
  const folder = (manifest?.name ?? '').slice(0, -'MANIFEST.sha256'.length)
  const voices = entries.filter((entry) => /\/voice\/\d{4}-[0-9a-f]{12}.*\.m4a$/.test(entry.name))
  expect(voices).toHaveLength(1)
  const recording = voices[0]!
  // An MP4 container: `ftyp` at byte four, what ffmpeg wrote and what an iPhone plays.
  expect(recording.data.subarray(4, 8).toString('latin1')).toBe('ftyp')
  const listed = manifest?.data.toString('utf8') ?? ''
  expect(listed).toContain(`${sha256(recording.data)}  ${recording.name.slice(folder.length)}`)
  expect(listed).toContain('# missing: 0')
  const book = entries.find((entry) => entry.name.endsWith('guestbook.txt'))
  expect(book?.data.toString('utf8')).toContain(recording.name.slice(folder.length))
})

test('the wall page is forbidden the microphone by the browser itself', async ({
  app,
  surfaces,
}) => {
  const { guest, projector } = surfaces
  const event = await app.seedEvent({ slug: 'micro-mur', template: 'wedding' })

  const wall = await projector.request.get(app.url(`/e/${event.slug}/display`))
  expect(wall.headers()['permissions-policy']).toContain('microphone=()')
  // The guest's own entry points are open: `/` and the upload page (the offline fallback serves `/`).
  for (const path of ['/', `/e/${event.slug}/upload`]) {
    const reply = await guest.request.get(app.url(path))
    expect(reply.headers()['permissions-policy'], path).toContain('microphone=(self)')
  }

  // Not just a header: a page that asks is refused by the engine, whatever the fake device would say.
  await projector.goto(app.url(`/e/${event.slug}/display`))
  const refusal = await projector.evaluate(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      return 'granted'
    } catch (error) {
      return (error as Error).name
    }
  })
  expect(refusal).toBe('NotAllowedError')
})

test('a sealed message has no player until the host opens the messages now', async ({
  app,
  surfaces,
}) => {
  const { guest, host } = surfaces
  const event = await app.seedEvent({ slug: 'voix-scellee', template: 'wedding' })
  const headers = await csrfHeaders(host.request, app)
  const sealed = await host.request.patch(app.url(`/api/events/${event.slug}/settings`), {
    headers,
    data: { guestbookVoice: { sealed: true } },
  })
  expect(sealed.status()).toBe(200)

  await arrive(guest, app, event.joinCode)
  await leaveAMessage(guest, 'Pour plus tard')
  await expect(guest.getByText(fr.guestbookVoice.thanksManual)).toBeVisible()

  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host.getByRole('tab', { name: new RegExp(`^${fr.moderation.tabMessages}`) }).click()
  await expect(host.getByText(fr.guestbookVoiceHost.sealedCard)).toBeVisible({ timeout: 60_000 })
  await expect(host.getByText(fr.guestbookVoiceHost.notListened)).toBeVisible()
  await expect(host.locator('audio')).toHaveCount(0)

  // The route says the same to the owner as to anybody: the secret is the server's, not the card's.
  const entries = await host.request.get(app.url(`/api/events/${event.slug}/guestbook`))
  const id = ((await entries.json()) as { items: { id: string }[] }).items[0]?.id
  const refused = await host.request.get(app.url(`/api/events/${event.slug}/guestbook/${id}/voice`))
  expect(refused.status()).toBe(403)

  // Lifted from the settings, after a confirmation, for good.
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/settings`))
  await host.getByRole('button', { name: fr.guestbookVoiceHost.openNow }).click()
  await host
    .getByRole('dialog')
    .getByRole('button', { name: fr.guestbookVoiceHost.openNow })
    .click()
  await expect(host.getByText(fr.guestbookVoiceHost.opened)).toBeVisible()

  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  await host.getByRole('tab', { name: new RegExp(`^${fr.moderation.tabMessages}`) }).click()
  await expect(host.getByLabel(/^Message vocal de Léa, 0:0[2-4]$/)).toBeVisible()
  const listened = await host.request.get(
    app.url(`/api/events/${event.slug}/guestbook/${id}/voice`),
    { headers: { range: 'bytes=0-1' } },
  )
  expect(listened.status()).toBe(206)
})

test('recording fits a 375 px phone without a sideways scroll', async ({ app, surfaces }) => {
  const { guest } = surfaces
  const event = await app.seedEvent({ slug: 'voix-375', template: 'wedding' })
  await guest.setViewportSize({ width: 375, height: 812 })
  await arrive(guest, app, event.joinCode)

  const fits = (): Promise<boolean> =>
    guest.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )

  expect(await fits(), 'the guestbook card').toBe(true)
  await openRecorder(guest)
  expect(await fits(), 'the recorder').toBe(true)
  await recordTake(guest, 2)
  await guest
    .getByLabel(fr.guestbookVoice.captionLabel)
    .fill('Un mot assez long pour tenir sur plusieurs lignes d’un téléphone')
  expect(await fits(), 'the take, with its caption').toBe(true)
  const send = guest.getByRole('button', { name: fr.guestbookVoice.send })
  const box = await send.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(375)
})
