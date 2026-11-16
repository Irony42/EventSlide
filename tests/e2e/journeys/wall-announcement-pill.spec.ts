import type { Locator, Page } from '@playwright/test'
import { WALL_QR_PLACEMENTS } from '../../../src/domain/events/wallJoinCard'
import { WALL_LAYOUTS } from '../../../src/domain/slideshow/wallLayout'
import { aGuestOf, aName, bytesOfFile, uploadPhoto } from '../fixtures/clients'
import { expect, test, wallUrl } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'
import { sessionOn, succeeded, type Session } from '../fixtures/session'
import type { TestApp } from '../fixtures/startTestApp'
import { OWNER_SETTLED_PASSWORD } from '../fixtures/startTestApp'
import {
  changeSlides,
  currentPhoto,
  forward,
  forwardUntil,
  openWallFrozen,
} from '../fixtures/wallClock'

/**
 * The discreet announcement's pill on the projected wall (spec 21, §6 and §10).
 *
 * Two things only a real browser lays out. The pill is chrome in the top-centre column, so no
 * layout reserves a place for it: it must nevertheless clear the invitation's QR, the challenge
 * banner, the souvenir counter and the captions in each of the seven layouts and at each of the
 * four corners the QR can be placed in, at the largest QR scale, on a 1920 x 1080 wall with a
 * challenge running and the counter on. That is the geometry the spec asked to be verified for
 * the clothesline's tag and the split's medallion in particular. And it is a layer: the
 * photographs go on rotating under it, and at its end it goes and takes nothing with it.
 *
 * The announcement is armed through the API, as the host's console will arm it. No
 * `waitForTimeout`: the geometry specs read the page as it is, and the one that needs a
 * discreet announcement's five minutes moves the page's clock.
 */

const PILL = '[data-wall-announcement-pill]'
const BANNER = '[data-wall-challenge]'
const COUNTER = '[data-testid="souvenir-counter"]'
const INVITE = '[data-testid="wall-invite"]'
const CAPTION = 'figcaption'

/** The widest the QR card gets (`WALL_QR_SCALE_MAX`): the worst case for the top corners. */
const WIDEST_QR = 1.5

const hostOf = async (app: TestApp): Promise<Session> => {
  const host = await sessionOn(app.baseUrl)
  const login = await host.post('/api/auth/login', {
    email: app.owner.email,
    password: OWNER_SETTLED_PASSWORD,
  })
  if (!succeeded(login)) throw new Error(`host login failed with ${login.status}`)
  return host
}

const ok = (reply: { status: number }, what: string): void => {
  if (!succeeded(reply as Parameters<typeof succeeded>[0])) {
    throw new Error(`${what} answered ${reply.status}`)
  }
}

/** An open event with captioned photographs, the counter on, the QR at its widest. */
const arrange = async (app: TestApp, label: string) => {
  const slug = aName(label).toLowerCase().replace(/\s+/g, '-')
  const event = await app.seedEvent({ slug, name: 'Camille & Sacha' })
  const host = await hostOf(app)
  const guest = await aGuestOf(app, event.joinCode)
  ok(
    await host.patch(`/api/events/${slug}/settings`, {
      moderation: 'auto',
      wall: { souvenirCounter: true, qrScale: WIDEST_QR },
    }),
    'settings',
  )
  for (let index = 0; index < 4; index += 1) {
    const sent = await uploadPhoto(
      guest,
      slug,
      await bytesOfFile(await aPhoto(`pastille-${slug}-${index}`, 1200, 900)),
      'photo.jpg',
      { caption: `Une légende de la photo ${index + 1}` },
    )
    expect(sent.status).toBe(201)
  }
  return { slug, host }
}

/** A discreet announcement from now, for the longest the domain allows. */
const launchDiscreet = async (host: Session, slug: string, durationSeconds = 1800) => {
  const launched = await host.post(`/api/events/${slug}/announcements`, {
    text: 'Le buffet est ouvert jusqu’à minuit, servez-vous',
    kind: 'discreet',
    durationSeconds,
  })
  expect(launched.status).toBe(201)
}

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const boxOf = async (locator: Locator, what: string): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`${what} has no box to measure`)
  return box
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Every box of a selector that is on screen (a layout may draw several captions, one invite). */
const boxesOf = async (page: Page, selector: string): Promise<Box[]> => {
  const found = page.locator(selector)
  const boxes: Box[] = []
  for (let index = 0; index < (await found.count()); index += 1) {
    const box = await found.nth(index).boundingBox()
    if (box !== null && box.width > 0 && box.height > 0) boxes.push(box)
  }
  return boxes
}

test.describe('the wall and the pill of a discreet announcement', () => {
  for (const layout of WALL_LAYOUTS) {
    test(`in the ${layout} layout the pill clears the QR, the challenge banner, the counter and the captions at each QR corner`, async ({
      app,
      surfaces,
    }) => {
      const { slug, host } = await arrange(app, `geometrie-${layout}`)
      ok(
        await host.post(`/api/events/${slug}/challenge`, {
          prompt: 'Un selfie avec les mariés',
          durationSeconds: 1800,
        }),
        'the challenge',
      )
      await launchDiscreet(host, slug)
      const { projector } = surfaces
      const viewport = projector.viewportSize()
      if (viewport === null) throw new Error('no viewport')

      for (const placement of WALL_QR_PLACEMENTS) {
        ok(
          await host.patch(`/api/events/${slug}/settings`, { wall: { qrPlacement: placement } }),
          'corner',
        )
        await projector.goto(wallUrl(app, slug, { layout }))
        await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
        await expect(projector.locator('[data-wall-layout]')).toHaveAttribute(
          'data-wall-layout',
          layout,
        )
        const pill = projector.locator(PILL)
        await expect(pill, `${layout} at ${placement}: the pill`).toBeVisible()
        await expect(projector.locator(BANNER)).toBeVisible()
        await expect(projector.locator(INVITE)).toBeVisible()

        const where = `${layout} at ${placement}`
        const box = await boxOf(pill, `${where}: the pill`)

        // Its gabarit: at most 40 % of the frame, inside the frame, and centred where nothing forbids it.
        expect(box.width, `${where}: width`).toBeLessThanOrEqual(viewport.width * 0.4 + 1)
        // Centred, except beside a card in a top corner, where it is centred in what the card
        // leaves (the overlap check below is what holds it clear of the card).
        if (!(layout === 'spotlight' && placement.startsWith('top'))) {
          expect(
            Math.abs(box.x + box.width / 2 - viewport.width / 2),
            `${where}: centred`,
          ).toBeLessThan(2)
        }
        expect(box.y, `${where}: inside the frame`).toBeGreaterThanOrEqual(0)
        expect(box.y + box.height, `${where}: inside the frame`).toBeLessThanOrEqual(
          viewport.height,
        )

        // Under the banner, which is the occupant of the place, never over it.
        const banner = await boxOf(projector.locator(BANNER), `${where}: the banner`)
        expect(box.y, `${where}: under the challenge banner`).toBeGreaterThanOrEqual(
          banner.y + banner.height,
        )

        // And it covers none of the things the room reads or scans.
        const others: readonly (readonly [string, string])[] = [
          ['the QR', INVITE],
          ['the counter', COUNTER],
          ['a caption', CAPTION],
        ]
        for (const [what, selector] of others) {
          for (const other of await boxesOf(projector, selector)) {
            expect(
              overlaps(box, other),
              `${where}: the pill covers ${what} ${JSON.stringify([box, other])}`,
            ).toBe(false)
          }
        }
      }
    })
  }

  test('puts the pill under the counter when no challenge runs', async ({ app, surfaces }) => {
    const { slug, host } = await arrange(app, 'sous-compteur')
    await launchDiscreet(host, slug)
    const { projector } = surfaces
    await projector.goto(wallUrl(app, slug))

    const pill = projector.locator(PILL)
    await expect(pill).toBeVisible()
    await expect(projector.locator(COUNTER)).toBeVisible()
    const counter = await boxOf(projector.locator(COUNTER), 'the counter')
    const box = await boxOf(pill, 'the pill')
    expect(box.y).toBeGreaterThanOrEqual(counter.y + counter.height)
    await expect(pill).toContainText('encore 30 min')
  })

  test('the photographs go on turning under the pill, which goes when the host takes it down and takes nothing with it', async ({
    app,
    surfaces,
  }) => {
    const { slug, host } = await arrange(app, 'rotation')
    const { projector } = surfaces
    await openWallFrozen(projector, wallUrl(app, slug))
    const pill = projector.locator(PILL)
    await expect(pill).toHaveCount(0)

    // The shortest a discreet announcement may be: five minutes, from now.
    await launchDiscreet(host, slug, 300)
    await forwardUntil(projector, 'the pill', () => pill.isVisible())
    await expect(pill).toContainText('Le buffet est ouvert')
    await expect(pill).toContainText('encore 5 min')
    await expect(pill.getByRole('status')).toHaveText(
      'Annonce : Le buffet est ouvert jusqu’à minuit, servez-vous.',
    )

    // It is a layer: the slide clock is not held, so the photograph under it changes.
    const before = await currentPhoto(projector)
    await changeSlides(projector, 2)
    expect(await currentPhoto(projector)).not.toBe(before)
    await expect(pill).toBeVisible()

    // The time left is rounded up and moves by the minute, on the wall's own clock.
    await forward(projector, 60_000)
    await expect(pill).toContainText('encore 4 min')

    // Its natural end is a derived instant, pinned one ring down on a clock the test owns (the
    // server's clock here is real, and five minutes of it is not worth a spec). Taking it down is
    // the other way out: the wall reads again on the signal and the pill is gone, the rest not.
    const listed = await host.get(`/api/events/${slug}/announcements`)
    const announcements = listed.body['announcements']
    const first = Array.isArray(announcements) ? (announcements[0] as { id?: unknown }) : undefined
    expect(typeof first?.id).toBe('string')
    ok(
      await host.delete(`/api/events/${slug}/announcements/${String(first?.id)}`),
      'taking it down',
    )
    await forwardUntil(projector, 'the pill gone', async () => (await pill.count()) === 0)
    // What holds the place (the counter) stays; only the pill went, and the photographs go on.
    await expect(projector.locator(COUNTER)).toBeVisible()
    const after = await currentPhoto(projector)
    await changeSlides(projector, 1)
    expect(await currentPhoto(projector)).not.toBe(after)
  })
})
