import { beforeEach, describe, expect, it } from 'vitest'
import { Slug } from '../../../domain/shared/slug'
import { aClient, anEvent, atPlus } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { makeSelectAlbumsToExport, type SelectAlbumsToExport } from './selectAlbumsToExport'

/**
 * Which albums the operator's export takes (spec 22, section 8). Every event closes at AT, so the
 * retention in days is its deadline in days from AT; the clock stands an hour after.
 */

const DAY = 86_400_000

let events: FakeEventRepository
let select: SelectAlbumsToExport

const slugOf = (value: string): Slug => {
  const made = Slug.create(value)
  if (!made.ok) throw new Error('bad slug')
  return made.value
}

let codes = 0
/** A join code is unique per event: `H7K2Q` and a letter. */
const nextCode = (): string => `H7K2Q${'ABCDEFGHJKLMNPRSTUVWXYZ'[codes++] ?? 'A'}`

const closed = (slug: string, retentionDays: number | null, id = slug) =>
  anEvent({ id, slug, status: 'closed', settings: { retentionDays }, joinCode: nextCode() })

beforeEach(() => {
  codes = 0
  const clients = new FakeClientRepository()
  events = new FakeEventRepository({ clients })
  select = makeSelectAlbumsToExport({
    events,
    clients,
    clock: new FakeClock(atPlus(60 * 60_000)),
    capNoticeDays: 30,
  })
})

const slugs = async (criteria: { dueWithinDays: number | null; slug: string | null }) => {
  const selection = await select({
    dueWithinDays: criteria.dueWithinDays,
    slug: criteria.slug === null ? null : slugOf(criteria.slug),
  })
  if (selection.kind !== 'albums') throw new Error(selection.kind)
  return selection.albums.map((album) => album.event.slug.value).sort()
}

describe('selectAlbumsToExport', () => {
  describe('--due-within', () => {
    beforeEach(() => {
      events.seed(
        closed('due-in-3-days', 3),
        closed('due-in-14-days', 14),
        closed('due-in-15-days', 15),
        closed('due-in-60-days', 60),
        closed('already-due', 1),
        anEvent({ id: 'running', slug: 'running', status: 'live', joinCode: nextCode() }),
        closed('no-deadline', null),
      )
    })

    it('takes the albums whose deadline falls within the window, the one on its last day included', async () => {
      expect(await slugs({ dueWithinDays: 14, slug: null })).toEqual([
        'already-due',
        'due-in-14-days',
        'due-in-3-days',
      ])
    })

    it('leaves out the one a day further, an evening still running and an album with no deadline', async () => {
      const found = await slugs({ dueWithinDays: 14, slug: null })

      expect(found).not.toContain('due-in-15-days')
      expect(found).not.toContain('running')
      expect(found).not.toContain('no-deadline')
    })

    it('widens with the window', async () => {
      expect(await slugs({ dueWithinDays: 30, slug: null })).toContain('due-in-15-days')
      expect(await slugs({ dueWithinDays: 30, slug: null })).not.toContain('due-in-60-days')
    })

    it('never takes an album the operator holds', async () => {
      await events.setPurgeHeld(closed('due-in-3-days', 3).id, atPlus(0))

      expect(await slugs({ dueWithinDays: 14, slug: null })).not.toContain('due-in-3-days')
    })

    it('narrows to one album with --event, and gives nothing when that one is not due', async () => {
      expect(await slugs({ dueWithinDays: 14, slug: 'due-in-3-days' })).toEqual(['due-in-3-days'])
      expect(await slugs({ dueWithinDays: 14, slug: 'due-in-60-days' })).toEqual([])
    })

    it('names the folder by the deletion date, not by the day of the run', async () => {
      const selection = await select({ dueWithinDays: 14, slug: slugOf('due-in-3-days') })

      expect(selection).toMatchObject({
        kind: 'albums',
        albums: [{ folder: 'due-in-3-days-2026-06-23', deadline: new Date(atPlus(3 * DAY)) }],
      })
    })
  })

  describe('--event alone', () => {
    it('takes that album whatever its date, so long as the evening is over', async () => {
      events.seed(closed('far-away', 400), closed('kept', null))

      expect(await slugs({ dueWithinDays: null, slug: 'far-away' })).toEqual(['far-away'])
      expect(await slugs({ dueWithinDays: null, slug: 'kept' })).toEqual(['kept'])
    })

    it('names the folder by the day of the run when the album has no deadline', async () => {
      events.seed(closed('kept', null))

      const selection = await select({ dueWithinDays: null, slug: slugOf('kept') })

      expect(selection).toMatchObject({ albums: [{ folder: 'kept-2026-06-20', deadline: null }] })
    })

    it('says so when the event does not exist', async () => {
      expect(await select({ dueWithinDays: null, slug: slugOf('nobody') })).toEqual({
        kind: 'unknownEvent',
        slug: 'nobody',
      })
    })

    it('says so when the evening is not over', async () => {
      events.seed(anEvent({ id: 'running', slug: 'running', status: 'live' }))

      expect(await select({ dueWithinDays: null, slug: slugOf('running') })).toEqual({
        kind: 'notClosed',
        slug: 'running',
      })
    })
  })

  it('judges an album with its client in the picture: a ceiling that comes first sets the folder date', async () => {
    const clients = new FakeClientRepository()
    clients.seed(aClient({ id: 'client-1', ceilings: { maxRetentionDays: 2 } }))
    events = new FakeEventRepository({ clients })
    select = makeSelectAlbumsToExport({
      events,
      clients,
      clock: new FakeClock(atPlus(60 * 60_000)),
      capNoticeDays: 30,
    })
    events.seed(
      anEvent({
        id: 'with-client',
        slug: 'with-client',
        status: 'closed',
        clientId: 'client-1',
        settings: { retentionDays: 365 },
        joinCode: nextCode(),
      }),
    )

    const selection = await select({ dueWithinDays: 14, slug: slugOf('with-client') })

    expect(selection).toMatchObject({ albums: [{ folder: 'with-client-2026-06-22' }] })
  })

  it('selects nothing without a criterion', async () => {
    events.seed(closed('due-in-3-days', 3))

    expect(await slugs({ dueWithinDays: null, slug: null })).toEqual([])
  })
})
