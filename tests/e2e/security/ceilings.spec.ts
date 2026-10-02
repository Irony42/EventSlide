import { expect, test } from '../fixtures/app'
import {
  aClientAccount,
  aGuestOf,
  aPlainAccount,
  bytesOfFile,
  codeOf,
  createEvent,
  createLiveEvent,
  detailsOf,
  existsFor,
  refusalOf,
  rewind,
  setCeilings,
  succeeded,
  uploadPhoto,
  usedBytesOf,
} from '../fixtures/clients'
import { aPhoto } from '../fixtures/media'
import { startTestApp } from '../fixtures/startTestApp'

/**
 * A client's ceilings, on the real build (roadmap §10.5; G2-05 of the free plan, P3-06 of the
 * paid one).
 *
 * `docs/SECURITY.md` says what a client may not do however it asks: ask for a quota the box
 * does not give, create one event more than it owns, take a month of wall for a weekend, keep
 * a guest's photographs for ever, send video its plan does not include, or fill the disk
 * through two events at once. Every case here is one of those, through the routes a host and a
 * guest use, against the server `dist/` built and the SQLite file it runs on — because a
 * ceiling that holds in a use-case test and is not wired into the composition root is the
 * defect this suite is for. The rules themselves are asserted at rings 1–4; what only this ring
 * can say is that the built box applies them.
 *
 * ## What these specs write to the database, and why
 *
 * No route makes a client yet (G2-14), so `fixtures/clients.ts` writes one, and writes its
 * ceilings. It also **moves stored instants** — `opened_at`, `closed_at` — which is how a
 * build with no clock seam is told that time has passed. Everything asserted goes through HTTP.
 *
 * ## Why one project
 *
 * Nothing here has a screen: every case is a request and a refusal. Running it in four
 * browsers would run the same HTTP four times, and the sweep case waits out a real minute.
 */

// eslint-disable-next-line no-empty-pattern -- Playwright reads the first parameter's destructuring to know which fixtures are wanted, so it has to be a pattern even when it is empty.
test.beforeEach(async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'API-level: one project is enough, and the sweep case waits a real minute',
  )
})

const GB = 1_000_000_000

test.describe('on a client’s quota', () => {
  test('a giant quotaBytes is refused 400 with the ceiling named, and one at the ceiling is accepted', async ({
    app,
  }) => {
    const client = await aClientAccount(app, { maxEventQuotaBytes: GB })

    const giant = await createEvent(client, { quotaBytes: 1_000_000_000_000_000 })
    const atTheCeiling = await createEvent(client, { quotaBytes: GB })

    expect(giant.reply.status).toBe(400)
    expect(codeOf(giant.reply)).toBe('event.quotaAboveCeiling')
    expect(detailsOf(giant.reply)).toEqual({ maxBytes: GB })
    expect(atTheCeiling.reply.status).toBe(201)
  })

  test('an event asking for no quota is given the ceiling, not the box default, when that is smaller', async ({
    app,
  }) => {
    const client = await aClientAccount(app, { maxEventQuotaBytes: 100_000_000 })
    const { slug } = await createEvent(client)

    const created = await client.api.get(`/api/events/${slug}`)

    expect(created.status).toBe(200)
    expect(created.body['quotaBytes']).toBe(100_000_000)
  })
})

test.describe('on how many events a client has', () => {
  test('the event after the last one allowed is refused 409, with what is used and what is the bound', async ({
    app,
  }) => {
    const client = await aClientAccount(app, { maxEvents: 2 })

    const first = await createEvent(client)
    const second = await createEvent(client)
    const third = await createEvent(client)

    expect([first.reply.status, second.reply.status]).toEqual([201, 201])
    expect(third.reply.status).toBe(409)
    expect(codeOf(third.reply)).toBe('client.ceilingReached')
    expect(detailsOf(third.reply)).toEqual({ ceiling: 'events', used: 2, max: 2 })
  })

  test('create, delete, recreate is refused under max_events_per_period: the counter never gives a slot back', async ({
    app,
  }) => {
    const client = await aClientAccount(app, { maxEventsPerPeriod: 1 })
    const first = await createEvent(client)
    const deleted = await client.api.delete(`/api/events/${first.slug}`)

    const again = await createEvent(client)

    expect(first.reply.status).toBe(201)
    expect(succeeded(deleted)).toBe(true)
    expect(again.reply.status).toBe(409)
    expect(detailsOf(again.reply)).toMatchObject({ ceiling: 'eventsPerPeriod' })
  })
})

test.describe('on whether a client may be live', () => {
  test('opening is refused 403 under live_allowed = 0, and the event stays a draft', async ({
    app,
  }) => {
    const client = await aClientAccount(app, { liveAllowed: false })
    const { slug } = await createEvent(client)

    const opened = await client.api.post(`/api/events/${slug}/status`, { status: 'live' })
    const after = await client.api.get(`/api/events/${slug}`)

    expect(opened.status).toBe(403)
    expect(codeOf(opened)).toBe('client.liveNotAllowed')
    expect(after.body['status']).toBe('draft')
  })

  test('a quarantined client can still prepare a draft', async ({ app }) => {
    const client = await aClientAccount(app, { liveAllowed: false })

    const created = await createEvent(client)

    expect(created.reply.status).toBe(201)
  })
})

test.describe('on how long a client’s events are kept', () => {
  test('“keep for ever” becomes the ceiling, and a retention of 3650 days is refused 400', async ({
    app,
  }) => {
    const client = await aClientAccount(app, { maxRetentionDays: 30 })
    const { slug } = await createEvent(client)

    const created = await client.api.get(`/api/events/${slug}`)
    const tooLong = await client.api.patch(`/api/events/${slug}/settings`, { retentionDays: 3650 })
    const forever = await client.api.patch(`/api/events/${slug}/settings`, { retentionDays: null })
    const atTheCeiling = await client.api.patch(`/api/events/${slug}/settings`, {
      retentionDays: 30,
    })

    expect(settingsOf(created)['retentionDays']).toBe(30)
    expect(tooLong.status).toBe(400)
    expect(codeOf(tooLong)).toBe('client.retentionAboveCeiling')
    expect(detailsOf(tooLong)).toEqual({ maxDays: 30 })
    expect(codeOf(forever)).toBe('client.retentionAboveCeiling')
    expect(atTheCeiling.status).toBe(200)
  })
})

test.describe('on whether a client may send video', () => {
  test('clips are switched off in the settings of a client that has none, and cannot be switched on', async ({
    app,
  }) => {
    const client = await aClientAccount(app, { clipsAllowed: false })
    const { slug } = await createEvent(client)

    const settings = await client.api.get(`/api/events/${slug}`)
    const switchOn = await client.api.patch(`/api/events/${slug}/settings`, { allowClips: true })

    expect(settingsOf(settings)['allowClips']).toBe(false)
    expect(switchOn.status).toBe(400)
    expect(codeOf(switchOn)).toBe('client.clipsNotAllowed')
  })

  test('a guest’s clip is refused 403 once the client has no clips, though the event itself still says yes', async ({
    app,
  }) => {
    // The downgrade: the event was made while the client had video, so its own switch is on.
    // Moving the client to a plan without video must stop the clip anyway.
    const client = await aClientAccount(app, { clipsAllowed: true })
    const { slug, joinCode } = await createLiveEvent(client)
    const guest = await aGuestOf(app, joinCode)
    const own = await client.api.get(`/api/events/${slug}`)
    setCeilings(app, client.clientId, { clipsAllowed: false })

    const clip = await guest.upload(`/api/events/${slug}/clips`, 'clip', {
      name: 'IMG_4021.MOV',
      type: 'video/quicktime',
      bytes: Buffer.alloc(2_048, 1),
    })

    expect(settingsOf(own)['allowClips']).toBe(true)
    expect(clip.status).toBe(403)
    expect(codeOf(clip)).toBe('event.clipsNotAllowed')
  })
})

test.describe('on how much a client may hold', () => {
  test('a ceiling shared by two of its events refuses the photograph that passes it, and another client or no client is unaffected', async ({
    app,
  }) => {
    const client = await aClientAccount(app, { maxTotalBytes: 50_000_000 })
    const wedding = await createLiveEvent(client)
    const brunch = await createLiveEvent(client)
    const weddingGuest = await aGuestOf(app, wedding.joinCode)
    const brunchGuest = await aGuestOf(app, brunch.joinCode)
    const photo = async (label: string): Promise<Buffer> =>
      bytesOfFile(await aPhoto(label, 1600, 1200))

    // One photograph, to learn what a photograph costs on this build: three renders of it.
    const first = await uploadPhoto(weddingGuest, wedding.slug, await photo('first'))
    const cost = await usedBytesOf(client, wedding.slug)
    // Room for two and a half: the brunch's photograph fits, the wedding's second does not.
    setCeilings(app, client.clientId, { maxTotalBytes: Math.floor(cost * 2.5) })
    const second = await uploadPhoto(brunchGuest, brunch.slug, await photo('second'))
    const third = await uploadPhoto(weddingGuest, wedding.slug, await photo('third'))

    expect(first.status).toBe(201)
    expect(cost).toBeGreaterThan(0)
    expect(refusalOf(first)).toBeNull()
    expect(refusalOf(second)).toBeNull()
    // The wedding is nowhere near its own quota: it is the **client's** total that stopped it.
    expect(third.status).toBe(201)
    expect(refusalOf(third)).toBe('client.storageFull')

    // Another client is not charged for it, and an event with no client has no ceiling.
    const neighbour = await aClientAccount(app, { maxTotalBytes: 50_000_000 })
    const neighbourEvent = await createLiveEvent(neighbour)
    const neighbourGuest = await aGuestOf(app, neighbourEvent.joinCode)
    const solo = await createLiveEvent(await aPlainAccount(app))
    const soloGuest = await aGuestOf(app, solo.joinCode)

    const theirs = await uploadPhoto(neighbourGuest, neighbourEvent.slug, await photo('theirs'))
    const nobodys = await uploadPhoto(soloGuest, solo.slug, await photo('nobodys'))

    expect(refusalOf(theirs)).toBeNull()
    expect(refusalOf(nobodys)).toBeNull()
  })
})

test.describe('on how long a client’s wall stays up', () => {
  test('a reopening after the window is refused 403, one inside it is not, and an event with no client reopens whenever', async ({
    app,
  }) => {
    const client = await aClientAccount(app, { maxLiveDays: 3 })
    const late = await createLiveEvent(client)
    const inside = await createLiveEvent(client)
    await client.api.post(`/api/events/${late.slug}/status`, { status: 'closed' })
    await client.api.post(`/api/events/${inside.slug}/status`, { status: 'closed' })
    // Ten days have gone by for one of them: it opened ten days ago and has been shut since.
    rewind(app, late.slug, { openedDaysAgo: 10, closedDaysAgo: 9 })

    const afterTheWindow = await client.api.post(`/api/events/${late.slug}/status`, {
      status: 'live',
    })
    const insideTheWindow = await client.api.post(`/api/events/${inside.slug}/status`, {
      status: 'live',
    })
    const stillClosed = await client.api.get(`/api/events/${late.slug}`)

    expect(afterTheWindow.status).toBe(403)
    expect(codeOf(afterTheWindow)).toBe('client.liveWindowOver')
    expect(stillClosed.body['status']).toBe('closed')
    expect(insideTheWindow.status).toBe(200)

    // The control: an event no client owns is reopened a year on, exactly as it always was.
    const plain = await aPlainAccount(app)
    const solo = await createLiveEvent(plain)
    await plain.api.post(`/api/events/${solo.slug}/status`, { status: 'closed' })
    rewind(app, solo.slug, { openedDaysAgo: 400, closedDaysAgo: 399 })
    const soloReopened = await plain.api.post(`/api/events/${solo.slug}/status`, {
      status: 'live',
    })
    expect(soloReopened.status).toBe(200)
  })
})

/**
 * What only a running box can show: the sweeps. A real one, started at one minute (the
 * smallest interval the configuration accepts), against events whose stored instants say that
 * time has gone by.
 *
 * Both sweeps run on the same boot, so this waits for the first one of each — about a
 * minute — and asserts the **whole contract** from it: the window closes an event that is
 * still live, and the purge honours the latest date a reopening cannot move, the notice a
 * lowered ceiling is owed, and an event nobody gave a ceiling.
 */
test.describe('on the box’s own sweeps', () => {
  // eslint-disable-next-line no-empty-pattern -- see the note on `beforeEach` above.
  test('a live event is closed when its window runs out, and a reopening does not push the purge back', async ({}, testInfo) => {
    test.setTimeout(240_000)
    const sweeping = await startTestApp({
      worker: testInfo.workerIndex,
      env: { SCHEDULE_SWEEP_INTERVAL_MINUTES: '1', RETENTION_SWEEP_INTERVAL_MINUTES: '1' },
    })
    try {
      // The one client every case but the notice belongs to: a month of retention, three days live.
      const client = await aClientAccount(sweeping, { maxRetentionDays: 30, maxLiveDays: 3 })
      // A: still live, four days after it opened. The sweep has to take the wall down.
      const stillLive = await createLiveEvent(client)
      rewind(sweeping, stillLive.slug, { openedDaysAgo: 4 })
      // B: opened forty days ago, reopened, and closed for the last time twenty days ago —
      //    closed_at + 30 would say day +10, but nothing a reopening does moves
      //    opened_at + 3 + 30 = day -7. It is already due.
      const reopened = await createLiveEvent(client)
      await client.api.post(`/api/events/${reopened.slug}/status`, { status: 'closed' })
      rewind(sweeping, reopened.slug, { openedDaysAgo: 40, closedDaysAgo: 20 })
      // C: closed ten days ago, opened eleven: due at day +20 (closed_at + 30) and the window
      //    bound is later still. It must still be here after the sweep.
      const young = await createLiveEvent(client)
      await client.api.post(`/api/events/${young.slug}/status`, { status: 'closed' })
      rewind(sweeping, young.slug, { openedDaysAgo: 11, closedDaysAgo: 10 })
      // E: an event kept for ever, closed sixty days ago, whose client's ceiling is lowered
      //    today to 14 days. The ceiling is set **after** the event exists, as an operator
      //    tightening a client would — set earlier it would have shortened the event's own
      //    retention, which is the host's promise and is judged on its own. The client is
      //    owed the notice, so the purge may not take it yet.
      const lowered = await aClientAccount(sweeping, {})
      const owed = await createLiveEvent(lowered)
      await lowered.api.post(`/api/events/${owed.slug}/status`, { status: 'closed' })
      rewind(sweeping, owed.slug, { openedDaysAgo: 61, closedDaysAgo: 60 })
      setCeilings(sweeping, lowered.clientId, {
        maxRetentionDays: 14,
        retentionCapSince: new Date(),
      })
      // D: an event no client owns, closed four hundred days ago and kept for ever. A self-hoster's
      //    album is never purged by a ceiling that is not theirs.
      const plain = await aPlainAccount(sweeping)
      const solo = await createLiveEvent(plain)
      await plain.api.post(`/api/events/${solo.slug}/status`, { status: 'closed' })
      rewind(sweeping, solo.slug, { openedDaysAgo: 401, closedDaysAgo: 400 })

      // The window sweep and the purge both run within a minute of boot.
      await expect
        .poll(
          async () => ({
            window: (await client.api.get(`/api/events/${stillLive.slug}`)).body['status'],
            purged: !(await existsFor(client, reopened.slug)),
          }),
          { timeout: 180_000, intervals: [2_000] },
        )
        .toEqual({ window: 'closed', purged: true })

      expect(await existsFor(client, young.slug)).toBe(true)
      expect(await existsFor(lowered, owed.slug)).toBe(true)
      expect(await existsFor(plain, solo.slug)).toBe(true)
    } finally {
      await sweeping.dispose()
    }
  })
})

/** The settings block of an event read back from the API. */
const settingsOf = (reply: { readonly body: Readonly<Record<string, unknown>> }) => {
  const settings = reply.body['settings']
  if (typeof settings !== 'object' || settings === null)
    throw new Error('the event has no settings')
  return settings as Readonly<Record<string, unknown>>
}
