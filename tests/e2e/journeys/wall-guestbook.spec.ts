import type { Page } from '@playwright/test'
import { aGuestOf, aName, bytesOfFile, uploadPhoto } from '../fixtures/clients'
import { expect, test, wallUrl } from '../fixtures/app'
import type { TestApp } from '../fixtures/startTestApp'
import { aPhoto } from '../fixtures/media'
import { sessionOn, succeeded, type Session } from '../fixtures/session'
import { OWNER_SETTLED_PASSWORD } from '../fixtures/startTestApp'

/**
 * Guestbook cards on the projected wall (spec 01).
 *
 * Two bugs went through with no journey watching: the host's arrow keys counted towards the
 * card's rhythm (#360, so a remote could summon or strand a card), and a running challenge's
 * banner sat under a card (#362). Both are about what a room sees on a screen nobody is
 * standing at, which only a real browser on a real server can say.
 *
 * The slide clock is driven by `e2e_interval` (250 ms), never by arrows: a card comes after
 * every sixth automatic change, so about every second and a half, and stays up for at least six
 * seconds, which is the server's rule and is not shortened here. Waits are on the DOM; the
 * observer below exists because a card can come and go between two polls.
 */

const MESSAGES = ['Merci pour cette soirée, c’est « magique » & inoubliable', 'Vive les mariés !']
const PENDING = 'Un message que personne n’a encore lu'
const REFUSED = 'Un message que l’hôte a refusé'

const CARD = '[data-wall-message]'

/** A host session over `fetch`: the owner the server bootstrapped. */
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
  expect(succeeded(reply as never), `${what} answered ${reply.status}`).toBe(true)
}

interface Arranged {
  readonly slug: string
  readonly host: Session
  readonly guest: Session
}

/**
 * An open event with three published photographs (the clock needs more than one) and the guestbook
 * on the wall. Messages are written by a guest and decided by the host through the API, as the
 * moderation console does: `published` ones reach the wall, one stays pending, one is refused.
 */
const arrange = async (app: TestApp, label: string): Promise<Arranged> => {
  const slug = aName(label).toLowerCase().replace(/\s+/g, '-')
  const event = await app.seedEvent({ slug, name: 'Camille & Sacha' })
  const host = await hostOf(app)
  const guest = await aGuestOf(app, event.joinCode)

  ok(await host.patch(`/api/events/${slug}/settings`, { moderation: 'auto' }), 'moderation: auto')
  for (let index = 0; index < 3; index += 1) {
    const sent = await uploadPhoto(
      guest,
      slug,
      await bytesOfFile(await aPhoto(`gb-${slug}-${index}`, 1200, 900)),
    )
    expect(sent.status).toBe(201)
  }

  // Back to manual: automatic moderation would publish the messages too, and one has to stay pending.
  ok(
    await host.patch(`/api/events/${slug}/settings`, { moderation: 'manual' }),
    'moderation: manual',
  )
  const other = await aGuestOf(app, event.joinCode)
  const written = async (text: string, by: Session = guest): Promise<string> => {
    const reply = await by.post(`/api/events/${slug}/guestbook`, { text })
    expect(reply.status, `writing "${text}"`).toBe(201)
    return String(reply.body['id'])
  }
  for (const text of MESSAGES) {
    const id = await written(text)
    ok(
      await host.patch(`/api/events/${slug}/guestbook/${id}/status`, { decision: 'publish' }),
      'publish',
    )
  }
  await written(PENDING)
  const refused = await written(REFUSED, other)
  ok(
    await host.patch(`/api/events/${slug}/guestbook/${refused}/status`, { decision: 'reject' }),
    'reject',
  )

  return { slug, host, guest }
}

interface Watch {
  /** Every card text that has been on screen since the watch began. */
  cards(): Promise<string[]>
  /** How many times the photograph on screen changed since the watch began. */
  changes(): Promise<number>
  /** Forgets what was seen so far, and counts again from here. */
  reset(): Promise<void>
}

/**
 * Records, inside the page, every card that appears and every slide change.
 *
 * A mutation observer rather than a poll: a card that came up and went away between two polls is
 * exactly the bug being looked for, and a test that cannot see it passes with the bug present.
 */
const watch = async (page: Page): Promise<Watch> => {
  await page.evaluate((card) => {
    const state = { cards: new Set<string>(), changes: 0, last: '' }
    const look = (): void => {
      for (const element of document.querySelectorAll(card)) {
        state.cards.add((element.querySelector('blockquote')?.textContent ?? '').trim())
      }
      const slide = document
        .querySelector('[data-testid="wall-slide"]')
        ?.getAttribute('data-photo-id')
      if (slide !== undefined && slide !== null && slide !== state.last) {
        state.last = slide
        state.changes += 1
      }
    }
    new MutationObserver(look).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    })
    ;(window as unknown as { __wallWatch: unknown }).__wallWatch = { state, look }
    look()
  }, CARD)
  type Hooks = { state: { cards: Set<string>; changes: number; last: string }; look: () => void }
  return {
    cards: () =>
      page.evaluate(() => [
        ...(window as unknown as { __wallWatch: Hooks }).__wallWatch.state.cards,
      ]),
    changes: () =>
      page.evaluate(() => (window as unknown as { __wallWatch: Hooks }).__wallWatch.state.changes),
    reset: () =>
      page.evaluate(() => {
        const { state } = (window as unknown as { __wallWatch: Hooks }).__wallWatch
        state.cards.clear()
        state.changes = 0
      }),
  }
}

test.describe('guestbook cards on the wall', () => {
  test('a card comes on the automatic rhythm and prints the message exactly', async ({
    app,
    surfaces,
  }) => {
    const { projector } = surfaces
    const { slug } = await arrange(app, 'gb-rhythm')

    await projector.goto(wallUrl(app, slug))
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()
    // No arrow is ever pressed on this wall: only the slide clock can have brought the card.
    const card = projector.locator(CARD)
    await expect(card).toBeVisible({ timeout: 15_000 })

    // The guest's own words, character for character (quotes, ampersand, accent): not translated,
    // not parsed as markup, not re-typeset.
    const text = (await card.locator('blockquote').textContent()) ?? ''
    expect(MESSAGES).toContain(text)
    await expect(card.locator('figcaption')).toHaveText(/\S/)

    // Messages go round: the other one follows, and only published ones are ever read out.
    const seen = await watch(projector)
    await expect.poll(async () => (await seen.cards()).length, { timeout: 30_000 }).toBe(2)
    expect([...(await seen.cards())].sort()).toEqual([...MESSAGES].sort())
  })

  test('an arrow leaves a card for a photograph, and no number of arrows summons one', async ({
    app,
    surfaces,
  }) => {
    const { projector } = surfaces
    const { slug } = await arrange(app, 'gb-arrows')

    await projector.goto(wallUrl(app, slug))
    const card = projector.locator(CARD)
    await expect(card).toBeVisible({ timeout: 15_000 })

    // The key goes to the page, not to a control that would swallow it.
    await projector.locator('body').click({ position: { x: 5, y: 5 } })
    await projector.keyboard.press('ArrowRight')
    await expect(card).toHaveCount(0)
    await expect(projector.getByTestId('wall-slide').first()).toBeVisible()

    // Pause the clock so that only arrows move the wall, then press sixty of them, either way. A
    // card summoned by an arrow (#360) is up for six seconds, but an observer sees it all the same.
    await projector.keyboard.press(' ')
    await expect(projector.getByText(/pause/i).first()).toBeVisible()
    const seen = await watch(projector)
    for (let press = 0; press < 30; press += 1) {
      await projector.keyboard.press('ArrowRight')
      await projector.keyboard.press('ArrowLeft')
    }
    await expect.poll(seen.changes).toBeGreaterThan(1)
    expect(await seen.cards()).toEqual([])
    await expect(card).toHaveCount(0)

    // The clock back on: the automatic changes bring a card again.
    await projector.keyboard.press(' ')
    await expect(card).toBeVisible({ timeout: 15_000 })
  })

  test('a running challenge stays in sight over a card, and no card starts while it runs', async ({
    app,
    surfaces,
  }) => {
    const { projector } = surfaces
    const { slug, host } = await arrange(app, 'gb-challenge')
    const mission = await host.post(`/api/events/${slug}/missions`, {
      prompt: 'Un selfie avec les mariés',
      scope: 'event',
    })
    ok(mission, 'creating the mission')

    await projector.goto(wallUrl(app, slug))
    const card = projector.locator(CARD)
    await expect(card).toBeVisible({ timeout: 15_000 })

    const started = await host.post(`/api/events/${slug}/challenge`, {
      missionId: String(mission.body['id']),
      durationSeconds: 120,
    })
    expect(started.status).toBe(201)

    const banner = projector.locator('[data-wall-challenge="running"]')
    await expect(banner).toBeVisible()
    // Visible is not seen: what is at the banner's centre has to be the banner (#362 put it under
    // the card). The card is asserted up in the same breath, or the check proves nothing.
    const covered = await projector.evaluate(
      ([bannerSelector, cardSelector]) => {
        const element = document.querySelector(bannerSelector as string)
        if (element === null) return 'no banner'
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        const cardUp = document.querySelector(cardSelector as string) !== null
        return `${cardUp ? 'card up' : 'card gone'}; ${hit !== null && element.contains(hit) ? 'banner on top' : 'banner covered'}`
      },
      ['[data-wall-challenge="running"]', CARD],
    )
    expect(covered).toBe('card up; banner on top')

    // The card ends on its own time; then the cadence goes by without bringing another.
    await expect(card).toHaveCount(0, { timeout: 15_000 })
    const seen = await watch(projector)
    await expect.poll(seen.changes, { timeout: 15_000 }).toBeGreaterThan(14)
    expect(await seen.cards()).toEqual([])
    await expect(banner).toBeVisible()

    // The challenge over, the cadence resumes.
    ok(await host.delete(`/api/events/${slug}/challenge`), 'stopping the challenge')
    await expect(card).toBeVisible({ timeout: 20_000 })
  })

  test('turning the guestbook off takes the card away without a reload', async ({
    app,
    surfaces,
  }) => {
    const { projector } = surfaces
    const { slug, host } = await arrange(app, 'gb-off')

    await projector.goto(wallUrl(app, slug))
    const card = projector.locator(CARD)
    await expect(card).toBeVisible({ timeout: 15_000 })
    const loaded = await projector.evaluate(() => performance.timeOrigin)

    ok(await host.patch(`/api/events/${slug}/settings`, { allowGuestbook: false }), 'settings')
    await expect(card).toHaveCount(0)

    // Many automatic changes later, still none: the next card was never queued.
    const seen = await watch(projector)
    await expect.poll(seen.changes, { timeout: 15_000 }).toBeGreaterThan(14)
    expect(await seen.cards()).toEqual([])
    expect(await projector.evaluate(() => performance.timeOrigin)).toBe(loaded)

    // And back on, the same screen takes it up again.
    ok(await host.patch(`/api/events/${slug}/settings`, { allowGuestbook: true }), 'settings')
    await expect(card).toBeVisible({ timeout: 15_000 })
  })

  test('a pending or refused message never reaches the wall', async ({ app, surfaces }) => {
    const { projector } = surfaces
    const { slug } = await arrange(app, 'gb-moderated')

    // What the room is served: the two published messages and nothing else.
    const served = await projector.request.get(app.url(`/api/events/${slug}/wall`))
    const wall = (await served.json()) as { guestbook?: { messages: { text: string }[] } }
    expect(wall.guestbook?.messages.map((message) => message.text).sort()).toEqual(
      [...MESSAGES].sort(),
    )

    // And what it showed, over a full round of cards.
    await projector.goto(wallUrl(app, slug))
    const seen = await watch(projector)
    await expect.poll(async () => (await seen.cards()).length, { timeout: 30_000 }).toBe(2)
    await expect(projector.getByText(PENDING)).toHaveCount(0)
    await expect(projector.getByText(REFUSED)).toHaveCount(0)
    expect(await seen.cards()).not.toContain(PENDING)
    expect(await seen.cards()).not.toContain(REFUSED)
  })
})
