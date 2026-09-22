/**
 * Screenshots of every shipped surface, on a laptop, a phone and a projector.
 *
 * Not part of any suite: a driver that boots the same real
 * server the end-to-end fixtures boot, seeds an evening through the real pages, and
 * photographs the result. Nothing here asserts anything — a failure means the shot did
 * not happen, and the missing file is the report.
 *
 * English throughout (roadmap §1.5): the browser contexts negotiate `en-GB`, which is
 * what the guest's phone and the host's console read their language from, and the
 * seeded event's `wallLanguage` is set to `en` explicitly, because the projector has
 * nobody in front of it to negotiate anything — see `src/domain/events/eventLanguage.ts`.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import sharp from 'sharp'
import { startTestApp } from '../tests/e2e/fixtures/startTestApp'

const OUT = process.env['SHOWCASE_OUT'] ?? join(process.cwd(), 'showcase')

/** A photograph that reads as one at a glance: a two-stop gradient under a soft vignette. */
const aPicture = async (name: string, from: string, to: string): Promise<string> => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/>
        <stop offset="100%" stop-color="${to}"/>
      </linearGradient>
      <radialGradient id="v" cx="50%" cy="45%" r="75%">
        <stop offset="60%" stop-color="rgba(0,0,0,0)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.45)"/>
      </radialGradient>
    </defs>
    <rect width="1600" height="1200" fill="url(#g)"/>
    <circle cx="1180" cy="300" r="150" fill="rgba(255,255,255,0.22)"/>
    <rect width="1600" height="1200" fill="url(#v)"/>
  </svg>`
  const path = join(OUT, '.fixtures', `${name}.jpg`)
  await writeFile(path, await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer())
  return path
}

const PICTURES = [
  { name: 'confetti', from: '#ff7a59', to: '#ffd166', caption: 'The confetti!', by: 'Mia' },
  {
    name: 'first-dance',
    from: '#5b6ee1',
    to: '#b06ab3',
    caption: 'The first dance',
    by: 'Jack',
  },
  { name: 'cake', from: '#06beb6', to: '#48b1bf', caption: 'The cake', by: 'Ava' },
  {
    name: 'speech',
    from: '#f7971e',
    to: '#ffd200',
    caption: 'The best man’s speech',
    by: 'Mia',
  },
  { name: 'photobooth', from: '#e96443', to: '#904e95', caption: 'Photobooth', by: 'Jack' },
  {
    name: 'dance-floor',
    from: '#4776e6',
    to: '#8e54e9',
    caption: 'The dance floor at midnight',
    by: 'Ava',
  },
  { name: 'rings', from: '#11998e', to: '#38ef7d', caption: 'The rings', by: 'Mia' },
  {
    name: 'send-off',
    from: '#fc5c7d',
    to: '#6a82fb',
    caption: 'The sparkler send-off',
    by: 'Jack',
  },
]

const shot = async (page: Page, name: string, fullPage = false): Promise<void> => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage })
  console.log(`  ✓ ${name}.png`)
}

const joinAndSend = async (
  page: Page,
  baseUrl: string,
  joinCode: string,
  displayName: string,
  files: { path: string; caption: string }[],
): Promise<void> => {
  await page.goto(`${baseUrl}/join/${joinCode}`)
  await page.getByLabel(/Your first name/i).fill(displayName)
  await page.getByRole('button', { name: /Join/i }).click()
  await page.waitForURL(/\/e\/[^/]+\/upload/)

  for (const [index, file] of files.entries()) {
    await page.getByTestId('photo-input').setInputFiles(file.path)
    const caption = page.getByLabel(/Caption/i)
    if (await caption.isVisible().catch(() => false)) await caption.fill(file.caption)
    await page.getByRole('button', { name: /Send/i }).click()
    await page
      .getByTestId(`upload-item-${index}`)
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => undefined)
    await page.waitForTimeout(800)
  }
}

const main = async (): Promise<void> => {
  await mkdir(join(OUT, '.fixtures'), { recursive: true })
  const pictures = await Promise.all(
    PICTURES.map(async (p) => ({ ...p, path: await aPicture(p.name, p.from, p.to) })),
  )

  console.log('booting a real server…')
  const app = await startTestApp({ worker: 41 })
  let browser: Browser | undefined

  try {
    const event = await app.seedEvent({
      slug: 'wedding',
      name: 'Grace & Noah',
      wallLanguage: 'en',
    })
    console.log(`seeded ${event.name} (code ${event.joinCode}) at ${app.baseUrl}`)

    browser = await chromium.launch()

    // ---- the phone -------------------------------------------------------------
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'en-GB',
    })
    const guest = await phone.newPage()

    await guest.goto(`${app.baseUrl}/join/${event.joinCode}`)
    await shot(guest, 'mobile-01-join')

    await guest.getByLabel(/Your first name/i).fill('Mia')
    await guest.getByRole('button', { name: /Join/i }).click()
    await guest.waitForURL(/\/e\/[^/]+\/upload/)
    await shot(guest, 'mobile-02-upload-empty')

    await guest.getByTestId('photo-input').setInputFiles(pictures[0]!.path)
    const caption = guest.getByLabel(/Caption/i)
    if (await caption.isVisible().catch(() => false)) await caption.fill(pictures[0]!.caption)
    await shot(guest, 'mobile-03-upload-ready')
    await guest.getByRole('button', { name: /Send/i }).click()
    await guest.waitForTimeout(2500)
    await shot(guest, 'mobile-04-upload-sent')

    // The rest of the evening, from three phones, so the wall has authors to show.
    for (const [index, name] of ['Jack', 'Ava'].entries()) {
      const other = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        locale: 'en-GB',
      })
      const page = await other.newPage()
      const mine = pictures.filter((p) => p.by === name)
      await joinAndSend(
        page,
        app.baseUrl,
        event.joinCode,
        name,
        mine.map((p) => ({ path: p.path, caption: p.caption })),
      )
      if (index === 0) await shot(page, 'mobile-05-upload-queued')
      await other.close()
    }
    const mineToo = pictures.filter((p) => p.by === 'Mia').slice(1)
    for (const [index, picture] of mineToo.entries()) {
      await guest.getByTestId('photo-input').setInputFiles(picture.path)
      const field = guest.getByLabel(/Caption/i)
      if (await field.isVisible().catch(() => false)) await field.fill(picture.caption)
      await guest.getByRole('button', { name: /Send/i }).click()
      await guest.waitForTimeout(1500)
      void index
    }

    // ---- the laptop ------------------------------------------------------------
    const laptop = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: 'en-GB',
    })
    const host = await laptop.newPage()

    await host.goto(`${app.baseUrl}/login`)
    await shot(host, 'web-01-login')

    await host.getByLabel(/Email address/i).fill(app.owner.email)
    await host.getByLabel(/Password/i).fill(app.owner.password)
    await host.getByRole('button', { name: /Sign in/i }).click()
    await host.waitForURL(/\/admin(?!\/password)/)
    // The URL changes before the page has its data, so a shot taken here photographs a
    // spinner. Wait for the network to go quiet and for a heading to exist.
    await host.waitForLoadState('networkidle')
    await host.getByRole('heading').first().waitFor({ state: 'visible' })
    await shot(host, 'web-02-dashboard')

    await host.goto(`${app.baseUrl}/admin/events/${event.slug}`)
    await host.waitForLoadState('networkidle')
    await host.getByRole('heading').first().waitFor({ state: 'visible' })
    await shot(host, 'web-03-event')

    await host.goto(`${app.baseUrl}/admin/events/${event.slug}/moderation`)
    await host.waitForTimeout(1200)
    await shot(host, 'web-04-moderation')

    // Publish everything but two, so the queue still has something to show and the
    // wall has something to display.
    for (let taken = 0; taken < 6; taken += 1) {
      const card = host.getByTestId('moderation-card').first()
      if (!(await card.isVisible().catch(() => false))) break
      await card.getByRole('button', { name: /Publish/i }).click()
      await host.waitForTimeout(500)
    }
    await shot(host, 'web-05-moderation-after')

    await host.goto(`${app.baseUrl}/admin/events/${event.slug}/settings`)
    await host.waitForTimeout(600)
    await shot(host, 'web-06-settings', true)

    // ---- the phone, as a moderator --------------------------------------------
    const phoneHost = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'en-GB',
    })
    const mobileHost = await phoneHost.newPage()
    await mobileHost.goto(`${app.baseUrl}/login`)
    await mobileHost.getByLabel(/Email address/i).fill(app.owner.email)
    await mobileHost.getByLabel(/Password/i).fill(app.owner.password)
    await mobileHost.getByRole('button', { name: /Sign in/i }).click()
    await mobileHost.waitForURL(/\/admin(?!\/password)/)
    await mobileHost.goto(`${app.baseUrl}/admin/events/${event.slug}/moderation/mobile`)
    await mobileHost.waitForTimeout(1500)
    // Wait for the card's own image to be decoded: a shot taken while it is still
    // loading photographs an empty card and says nothing about the layout.
    await mobileHost
      .waitForFunction(
        () =>
          [...document.querySelectorAll('img')].some((img) => img.complete && img.naturalWidth > 0),
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => console.log('  ! the phone moderation card never decoded an image'))
    await mobileHost.waitForTimeout(1200)
    await shot(mobileHost, 'mobile-06-moderation')

    // ---- the projector ---------------------------------------------------------
    const projector = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      locale: 'en-GB',
      reducedMotion: 'no-preference',
    })
    const wall = await projector.newPage()

    for (const layout of ['spotlight', 'mosaic', 'polaroid', 'filmstrip', 'collage', 'split']) {
      // A multi-slot layout fills one slide at a time, so a long interval photographs a
      // wall that is still filling. Short interval, then wait for the slots to settle.
      await wall.goto(
        `${app.baseUrl}/e/${event.slug}/display?layout=${layout}&e2e_interval=350&e2e_transition=0`,
      )
      await wall.waitForTimeout(9000)
      await shot(wall, `wall-${layout}`)
    }

    // ---- the wall's photo-missions panel ---------------------------------------
    //
    // Added after every layout above is already photographed, and deliberately so: the
    // panel is top-left on every layout once the event has missions (see
    // `WallMissions.module.css`), and adding it earlier would put it in every one of the
    // shots just taken. One guest answers one prompt, so the panel shows a mix of an
    // answered and an open row rather than four identical circles.
    console.log('adding photo missions…')
    await app.createMission(event.slug, { prompt: 'A selfie with the couple', scope: 'guest' })
    await app.createMission(event.slug, { prompt: 'The worst dance move', scope: 'guest' })
    await app.createMission(event.slug, { prompt: 'Someone crying', scope: 'guest' })
    await app.createMission(event.slug, {
      prompt: 'The cake, before it disappears',
      scope: 'event',
    })

    const bouquet = await aPicture('bouquet', '#ff9a8b', '#ff6a88')
    await guest.goto(`${app.baseUrl}/e/${event.slug}/upload`)
    await guest.getByRole('button', { name: /A selfie with the couple/i }).click()
    await guest.getByTestId('photo-input').setInputFiles(bouquet)
    const bonusCaption = guest.getByLabel(/Caption/i)
    if (await bonusCaption.isVisible().catch(() => false)) {
      await bonusCaption.fill('The bouquet toss')
    }
    await guest.getByRole('button', { name: /Send/i }).click()
    await guest.waitForTimeout(1500)

    // A published photo is what the domain counts as an answer (roadmap §2.1) — a
    // pending one would leave the panel with nothing ticked.
    await host.goto(`${app.baseUrl}/admin/events/${event.slug}/moderation`)
    await host.waitForTimeout(1200)
    const bonusCard = host.getByTestId('moderation-card').filter({ hasText: 'The bouquet toss' })
    await bonusCard.waitFor({ state: 'visible', timeout: 15_000 })
    await bonusCard.getByRole('button', { name: /Publish/i }).click()
    await host.waitForTimeout(800)

    await wall.goto(
      `${app.baseUrl}/e/${event.slug}/display?layout=spotlight&e2e_interval=350&e2e_transition=0`,
    )
    const missionsPanel = wall
      .getByRole('heading', { name: 'Missions' })
      .locator('..')
      .locator('..')
    await missionsPanel.waitFor({ state: 'visible', timeout: 15_000 })
    await wall.waitForTimeout(1000)
    const panelBox = await missionsPanel.boundingBox()
    if (panelBox === null) throw new Error('the missions panel never reported a bounding box')
    const pad = 24
    await wall.screenshot({
      path: join(OUT, 'wall-missions.png'),
      clip: {
        x: Math.max(0, panelBox.x - pad),
        y: Math.max(0, panelBox.y - pad),
        width: panelBox.width + pad * 2,
        height: panelBox.height + pad * 2,
      },
    })
    console.log('  ✓ wall-missions.png')

    console.log(`\nscreenshots in ${OUT}`)
  } finally {
    await browser?.close()
    await app.dispose()
  }
}

await main()
