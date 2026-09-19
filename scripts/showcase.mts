/**
 * Screenshots of every shipped surface, on a laptop, a phone and a projector.
 *
 * Not part of any suite: a driver that boots the same real
 * server the end-to-end fixtures boot, seeds an evening through the real pages, and
 * photographs the result. Nothing here asserts anything — a failure means the shot did
 * not happen, and the missing file is the report.
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
  { name: 'confettis', from: '#ff7a59', to: '#ffd166', caption: 'Les confettis !', by: 'Léa' },
  {
    name: 'premiere-danse',
    from: '#5b6ee1',
    to: '#b06ab3',
    caption: 'La première danse',
    by: 'Tom',
  },
  { name: 'gateau', from: '#06beb6', to: '#48b1bf', caption: 'Le gâteau', by: 'Inès' },
  { name: 'toast', from: '#f7971e', to: '#ffd200', caption: 'Le discours du témoin', by: 'Léa' },
  { name: 'photobooth', from: '#e96443', to: '#904e95', caption: 'Photobooth', by: 'Tom' },
  { name: 'la-piste', from: '#4776e6', to: '#8e54e9', caption: 'La piste à minuit', by: 'Inès' },
  { name: 'les-mains', from: '#11998e', to: '#38ef7d', caption: 'Les alliances', by: 'Léa' },
  {
    name: 'sortie',
    from: '#fc5c7d',
    to: '#6a82fb',
    caption: 'La sortie aux étincelles',
    by: 'Tom',
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
  await page.getByLabel(/Votre prénom/i).fill(displayName)
  await page.getByRole('button', { name: /Rejoindre/i }).click()
  await page.waitForURL(/\/e\/[^/]+\/upload/)

  for (const [index, file] of files.entries()) {
    await page.getByTestId('photo-input').setInputFiles(file.path)
    const caption = page.getByLabel(/Légende/i)
    if (await caption.isVisible().catch(() => false)) await caption.fill(file.caption)
    await page.getByRole('button', { name: /Envoyer/i }).click()
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
    const event = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })
    console.log(`seeded ${event.name} (code ${event.joinCode}) at ${app.baseUrl}`)

    browser = await chromium.launch()

    // ---- the phone -------------------------------------------------------------
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'fr-FR',
    })
    const guest = await phone.newPage()

    await guest.goto(`${app.baseUrl}/join/${event.joinCode}`)
    await shot(guest, 'mobile-01-join')

    await guest.getByLabel(/Votre prénom/i).fill('Léa')
    await guest.getByRole('button', { name: /Rejoindre/i }).click()
    await guest.waitForURL(/\/e\/[^/]+\/upload/)
    await shot(guest, 'mobile-02-upload-vide')

    await guest.getByTestId('photo-input').setInputFiles(pictures[0]!.path)
    const caption = guest.getByLabel(/Légende/i)
    if (await caption.isVisible().catch(() => false)) await caption.fill(pictures[0]!.caption)
    await shot(guest, 'mobile-03-upload-pret')
    await guest.getByRole('button', { name: /Envoyer/i }).click()
    await guest.waitForTimeout(2500)
    await shot(guest, 'mobile-04-upload-envoye')

    // The rest of the evening, from three phones, so the wall has authors to show.
    for (const [index, name] of ['Tom', 'Inès'].entries()) {
      const other = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        locale: 'fr-FR',
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
      if (index === 0) await shot(page, 'mobile-05-upload-file')
      await other.close()
    }
    const mineToo = pictures.filter((p) => p.by === 'Léa').slice(1)
    for (const [index, picture] of mineToo.entries()) {
      await guest.getByTestId('photo-input').setInputFiles(picture.path)
      const field = guest.getByLabel(/Légende/i)
      if (await field.isVisible().catch(() => false)) await field.fill(picture.caption)
      await guest.getByRole('button', { name: /Envoyer/i }).click()
      await guest.waitForTimeout(1500)
      void index
    }

    // ---- the laptop ------------------------------------------------------------
    const laptop = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: 'fr-FR',
    })
    const host = await laptop.newPage()

    await host.goto(`${app.baseUrl}/login`)
    await shot(host, 'web-01-connexion')

    await host.getByLabel(/Adresse e-mail/i).fill(app.owner.email)
    await host.getByLabel(/Mot de passe/i).fill(app.owner.password)
    await host.getByRole('button', { name: /Se connecter/i }).click()
    await host.waitForURL(/\/admin(?!\/password)/)
    // The URL changes before the page has its data, so a shot taken here photographs a
    // spinner. Wait for the network to go quiet and for a heading to exist.
    await host.waitForLoadState('networkidle')
    await host.getByRole('heading').first().waitFor({ state: 'visible' })
    await shot(host, 'web-02-tableau-de-bord')

    await host.goto(`${app.baseUrl}/admin/events/${event.slug}`)
    await host.waitForLoadState('networkidle')
    await host.getByRole('heading').first().waitFor({ state: 'visible' })
    await shot(host, 'web-03-evenement')

    await host.goto(`${app.baseUrl}/admin/events/${event.slug}/moderation`)
    await host.waitForTimeout(1200)
    await shot(host, 'web-04-moderation')

    // Publish everything but two, so the queue still has something to show and the
    // wall has something to display.
    for (let taken = 0; taken < 6; taken += 1) {
      const card = host.getByTestId('moderation-card').first()
      if (!(await card.isVisible().catch(() => false))) break
      await card.getByRole('button', { name: /Publier/i }).click()
      await host.waitForTimeout(500)
    }
    await shot(host, 'web-05-moderation-apres')

    await host.goto(`${app.baseUrl}/admin/events/${event.slug}/settings`)
    await host.waitForTimeout(600)
    await shot(host, 'web-06-reglages', true)

    // ---- the phone, as a moderator --------------------------------------------
    const phoneHost = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'fr-FR',
    })
    const mobileHost = await phoneHost.newPage()
    await mobileHost.goto(`${app.baseUrl}/login`)
    await mobileHost.getByLabel(/Adresse e-mail/i).fill(app.owner.email)
    await mobileHost.getByLabel(/Mot de passe/i).fill(app.owner.password)
    await mobileHost.getByRole('button', { name: /Se connecter/i }).click()
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
      locale: 'fr-FR',
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
      await shot(wall, `mur-${layout}`)
    }

    console.log(`\nscreenshots in ${OUT}`)
  } finally {
    await browser?.close()
    await app.dispose()
  }
}

await main()
