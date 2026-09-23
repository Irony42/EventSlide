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
 *
 * Run it against a fresh build, because the server it boots is `dist/`:
 *
 *   npm run build && npx tsx scripts/showcase.mts --out <dir>
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import sharp from 'sharp'
import { startTestApp } from '../tests/e2e/fixtures/startTestApp'

/** `--out <dir>` picks the folder; the environment is read by `env.ts` and nothing else. */
const outFlag = process.argv.indexOf('--out')
const OUT =
  (outFlag >= 0 ? process.argv[outFlag + 1] : undefined) ?? join(process.cwd(), 'showcase')

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

/**
 * The address the server builds links from, and the one the README's install uses.
 *
 * Only two things are built from it — the join link the QR code encodes, and the shared
 * gallery's address — and the second is printed on the host's panel, so a shot of that
 * panel would otherwise show `http://127.0.0.1:<ephemeral port>`. Nothing checks a
 * request's origin against it, so the browsers keep talking to `app.baseUrl`, and a link
 * the server hands out is followed with its origin swapped for that one (`local`).
 */
const PUBLIC_URL = 'https://photos.example.com'

const local = (baseUrl: string, link: string): string => {
  const { pathname, search } = new URL(link)
  return `${baseUrl}${pathname}${search}`
}

const shot = async (page: Page, name: string, fullPage = false): Promise<void> => {
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage })
  console.log(`  ✓ ${name}.png`)
}

/** An element on its own, for a panel that means something without the page around it. */
const shotOf = async (page: Page, locator: Locator, name: string): Promise<void> => {
  await page.waitForTimeout(400)
  await locator.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`  ✓ ${name}.png`)
}

/**
 * An element with a margin of the page around it, for one that draws no edge of its own.
 *
 * Clipped from a full-page capture rather than the viewport, so an element taller than the
 * screen comes out whole; the box is read at the top of the page, where the viewport's
 * coordinates and the page's are the same.
 */
const shotAround = async (page: Page, locator: Locator, name: string, pad: number) => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`${name}: the element never reported a bounding box`)
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    fullPage: true,
    clip: { x, y, width: box.x + box.width + pad - x, height: box.y + box.height + pad - y },
  })
  console.log(`  ✓ ${name}.png`)
}

/**
 * Waits until every image that is on screen has decoded.
 *
 * On screen only: the gallery's grid is lazy, so a tile below the fold never loads until
 * somebody scrolls to it, and waiting for *every* `<img>` would wait for nothing.
 */
const visibleImagesDecoded = async (page: Page): Promise<void> => {
  await page
    .waitForFunction(
      () => {
        const onScreen = [...document.querySelectorAll('img')].filter((img) => {
          const box = img.getBoundingClientRect()
          return box.width > 0 && box.bottom > 0 && box.top < window.innerHeight
        })
        return onScreen.length > 0 && onScreen.every((img) => img.complete && img.naturalWidth > 0)
      },
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => console.log('  ! an image on screen never decoded'))
}

/**
 * Gets a guest past the privacy notice and onto the picker (roadmap §5.1).
 *
 * The upload screen offers nothing that sends until this phone has read the notice, so
 * every first visit meets it and a later one does not. The composer is waited on first,
 * because the card and the picker render in the same commit from the session the join
 * wrote — once it is on screen, whether the card is there is already decided. The
 * acknowledgement is waited on as a response, not only as a picker, because the screen
 * hands the picker over at the tap, before the server has recorded anything.
 *
 * The same moves as `passPrivacyNotice` in `tests/e2e/fixtures/guest.ts`, restated rather
 * than imported because that one asserts with `@playwright/test`'s `expect`, and this
 * driver asserts nothing (see the file comment).
 */
const passNotice = async (page: Page, photograph?: string): Promise<void> => {
  await page.getByTestId('upload-composer').waitFor({ state: 'visible' })
  const notice = page.getByTestId('privacy-notice')
  if ((await notice.count()) > 0) {
    // The card alone: on a phone it is taller than the screen, so a viewport shot holds
    // either its heading or its button and never both. With a margin, because the card
    // sits inside the composer and has no border of its own.
    if (photograph !== undefined) await shotAround(page, notice, photograph, 16)
    const recorded = page.waitForResponse(
      (response) =>
        response.url().endsWith('/privacy-notice/acknowledgement') && response.status() === 200,
    )
    await notice.getByRole('button', { name: 'I understand' }).click()
    await recorded
  }
  await page.getByTestId('photo-input').waitFor({ state: 'attached' })
  // Photographing the card scrolls to it, and the picker takes focus when it replaces the
  // card; the shots that follow are of the screen a guest lands on, from the top.
  await page.evaluate(() => window.scrollTo(0, 0))
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
  await passNotice(page)

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
  const app = await startTestApp({ worker: 41, env: { PUBLIC_URL } })
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
    // The notice stands where the picker will be until this phone has read it.
    await passNotice(guest, 'mobile-02-notice')
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
    await wall.waitForTimeout(600)
    await shotAround(wall, missionsPanel, 'wall-missions', 24)

    // ---- the morning after: the shared gallery ---------------------------------
    //
    // Last, because it is the last thing that happens: every photograph above is already
    // decided, so the album holds what the wall showed — published, and nothing pending.
    //
    // The host's half is taken on the phone: on a laptop the panel is as wide as the event
    // page's content, and at the size a README floats an image its text would be unreadable.
    console.log('sharing the album…')
    const password = 'june wedding'
    await mobileHost.goto(`${app.baseUrl}/admin/events/${event.slug}`)
    await mobileHost.waitForLoadState('networkidle')
    // The panel is a titled `Card`, which renders as a `<section>` holding its heading.
    const sharePanel = mobileHost
      .locator('section')
      .filter({ has: mobileHost.getByRole('heading', { level: 2, name: 'Shared album' }) })
    await sharePanel.getByText('No link is active.').waitFor({ state: 'visible' })
    await shotOf(mobileHost, sharePanel, 'mobile-07-gallery-panel')

    await sharePanel.getByLabel(/^Password/).fill(password)
    await sharePanel.getByRole('button', { name: 'Create the link' }).click()
    const address = sharePanel.getByLabel('Link address')
    await address.waitFor({ state: 'visible' })
    const link = local(app.baseUrl, await address.inputValue())
    // The status line reloads after the address arrives; wait for it to say the link is open.
    await sharePanel.getByText(/^Open until/).waitFor({ state: 'visible' })
    await shotOf(mobileHost, sharePanel, 'mobile-08-gallery-panel-created')

    // A relative who was never in the room, on a phone: a fresh context, so no cookie from
    // the evening is carried in.
    const relativePhone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'en-GB',
    })
    const relative = await relativePhone.newPage()
    await relative.goto(link)
    await relative.getByRole('heading', { name: 'Protected album' }).waitFor()
    await shot(relative, 'gallery-01-locked')
    await relative.getByLabel('Password').fill(password)
    await relative.getByRole('button', { name: 'Open the album' }).click()
    await relative.getByRole('heading', { level: 1, name: event.name }).waitFor()
    await visibleImagesDecoded(relative)
    await shot(relative, 'gallery-02-album')
    await relative.getByRole('button', { name: 'Enlarge photo 2' }).click()
    await relative.getByRole('dialog').waitFor({ state: 'visible' })
    await visibleImagesDecoded(relative)
    await shot(relative, 'gallery-03-viewer')
    await relative.keyboard.press('Escape')

    // The same album on a laptop, where a centred dialog and a pinned one look different.
    const relativeLaptop = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: 'en-GB',
    })
    const cousin = await relativeLaptop.newPage()
    await cousin.goto(link)
    await cousin.getByLabel('Password').fill(password)
    await cousin.getByRole('button', { name: 'Open the album' }).click()
    await cousin.getByRole('heading', { level: 1, name: event.name }).waitFor()
    await visibleImagesDecoded(cousin)
    await shot(cousin, 'gallery-04-album-laptop')
    await cousin.getByRole('button', { name: 'Enlarge photo 3' }).click()
    await cousin.getByRole('dialog').waitFor({ state: 'visible' })
    await visibleImagesDecoded(cousin)
    await shot(cousin, 'gallery-05-viewer-laptop')

    // Switched off: the same address, one reload later.
    await sharePanel.getByRole('button', { name: 'Switch off the link' }).click()
    await mobileHost
      .getByRole('dialog', { name: 'Switch off this link?' })
      .getByRole('button', { name: 'Switch off the link' })
      .click()
    await sharePanel.getByText('No link is active.').waitFor({ state: 'visible' })
    await relative.reload()
    await relative.getByRole('heading', { name: 'This link is no longer available' }).waitFor()
    await shot(relative, 'gallery-06-switched-off')

    console.log(`\nscreenshots in ${OUT}`)
  } finally {
    await browser?.close()
    await app.dispose()
  }
}

await main()
