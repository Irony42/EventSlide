import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asPhotoId } from '../../../domain/shared/ids'
import { AT, anEvent, aPhoto } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeGetSiteEventState } from './getSiteEventState'
import { makeGetSitePhotoState } from './getSitePhotoState'
import { LOOKUP_LIMIT, makeLookupSiteEvents, type LookupSiteEvents } from './lookupSiteEvents'

/**
 * The operator's reads for the takedown screens (launch review S5): which event does a report
 * name, is it down or held, where is this photograph. **Ids, a status and instants, and never a
 * name, a slug or a join code**: a lookup by any of them answers with none of them.
 */

const EVENT = asEventId('event-1')

describe('lookupSiteEvents', () => {
  let events: FakeEventRepository
  let lookup: LookupSiteEvents

  beforeEach(() => {
    events = new FakeEventRepository().seed(
      anEvent({
        id: 'event-1',
        name: 'Mariage de Camille',
        slug: 'mariage-de-camille',
        joinCode: 'H7K2QM',
      }),
      anEvent({ id: 'event-2', name: 'Gala', slug: 'gala-acme', joinCode: '2AB3CD' }),
    )
    lookup = makeLookupSiteEvents({ events })
  })

  const ids = async (query: string): Promise<readonly string[]> => {
    const result = await lookup({ query })
    if (!result.ok) throw new Error(result.error.code)
    return result.value.map((state) => state.id)
  }

  it.each([
    ['a slug', 'mariage-de-camille'],
    ['a slug typed in capitals', '  Mariage-De-Camille '],
    ['a join code', 'H7K2QM'],
    ['a join code typed in lower case', 'h7k2qm'],
    ['an exact name, whatever its case', 'MARIAGE DE CAMILLE'],
    ['an address to the wall', 'https://app.example.org/e/mariage-de-camille/display'],
    [
      'an address to the host console',
      'https://app.example.org/api/events/mariage-de-camille/wall',
    ],
    ['an address that is a join link', 'https://app.example.org/join/H7K2QM'],
  ])('finds the event from %s', async (_what, query) => {
    expect(await ids(query)).toEqual(['event-1'])
  })

  it('answers every event a free-text query finds, once: a slug, a code and a name together', async () => {
    const both = new FakeEventRepository().seed(
      anEvent({ id: 'event-a', name: 'Fête', slug: 'fete', joinCode: 'H7K2QM' }),
      anEvent({ id: 'event-b', name: 'fete', slug: 'autre-fete', joinCode: '2AB3CD' }),
    )

    const result = await makeLookupSiteEvents({ events: both })({ query: 'FETE' })

    expect(result.ok && result.value.map((state) => state.id).sort()).toEqual([
      'event-a',
      'event-b',
    ])
  })

  it('reads an address as the slug it carries and nothing else: no name search on a pasted link', async () => {
    const named = new FakeEventRepository().seed(
      anEvent({
        id: 'event-a',
        name: 'https://x.test/e/camille',
        slug: 'camille-a',
        joinCode: 'H7K2QM',
      }),
    )

    const result = await makeLookupSiteEvents({ events: named })({
      query: 'https://x.test/e/camille',
    })

    expect(result.ok && result.value).toEqual([])
  })

  it('finds nothing for a name that is only part of one: a lookup is not a way to browse names', async () => {
    expect(await ids('Mariage')).toEqual([])
    expect(await ids('mariage-de')).toEqual([])
  })

  it('answers only ids, a status and instants: never the name, the slug or the join code', async () => {
    const result = await lookup({ query: 'mariage-de-camille' })

    expect(result.ok && Object.keys(result.value[0] ?? {}).sort()).toEqual([
      'clientId',
      'createdAt',
      'id',
      'purgeHeldAt',
      'status',
      'takenDownAt',
    ])
    const text = JSON.stringify(result.ok ? result.value : null)
    for (const content of ['Camille', 'mariage-de-camille', 'H7K2QM']) {
      expect(text).not.toContain(content)
    }
  })

  it('says whether an event is down or held, as the instants it was', async () => {
    await events.setTakenDown(EVENT, AT)
    await events.setPurgeHeld(EVENT, AT)

    const result = await lookup({ query: 'H7K2QM' })

    expect(result.ok && [result.value[0]?.takenDownAt, result.value[0]?.purgeHeldAt]).toEqual([
      AT,
      AT,
    ])
  })

  it('answers every event of that exact name, and at most the limit', async () => {
    const many = new FakeEventRepository()
    for (let n = 1; n <= LOOKUP_LIMIT + 3; n += 1) {
      many.seed(
        anEvent({
          id: `twin-${n}`,
          name: 'Soirée',
          slug: `soiree-${n}`,
          joinCode: `A${String(n).padStart(5, '0')}`.replace(/[ILOU]/g, 'B'),
        }),
      )
    }

    const result = await makeLookupSiteEvents({ events: many })({ query: 'soirée' })

    expect(result.ok && result.value).toHaveLength(LOOKUP_LIMIT)
  })

  it.each([
    ['a blank query', '   '],
    ['an empty one', ''],
    ['one far too long', 'x'.repeat(301)],
  ])('refuses %s with siteLookup.queryInvalid', async (_what, query) => {
    const result = await lookup({ query })

    expect(!result.ok && result.error.code).toBe('siteLookup.queryInvalid')
  })

  it('answers an empty list, not an error, for something that is nobody', async () => {
    expect(await ids('personne-ici')).toEqual([])
  })
})

describe('getSiteEventState', () => {
  it('answers one event by id, and 404 event.notFound for an id nobody holds', async () => {
    const events = new FakeEventRepository().seed(anEvent({ id: 'event-1' }))
    const state = makeGetSiteEventState({ events })

    const found = await state({ eventId: EVENT })
    const missing = await state({ eventId: asEventId('ghost') })

    expect(found.ok && found.value.id).toBe('event-1')
    expect(!missing.ok && missing.error.code).toBe('event.notFound')
  })
})

describe('getSitePhotoState', () => {
  it('answers where a photograph is and whether it is down, and 404 photo.notFound for an id nobody holds', async () => {
    const photos = new FakePhotoRepository().seed(aPhoto({ id: 'photo-1', eventId: 'event-1' }))
    await photos.setTakenDown(EVENT, asPhotoId('photo-1'), AT)
    const state = makeGetSitePhotoState({ photos })

    const found = await state({ photoId: asPhotoId('photo-1') })
    const missing = await state({ photoId: asPhotoId('ghost') })

    expect(found.ok && found.value).toEqual({
      id: 'photo-1',
      eventId: 'event-1',
      takenDownAt: AT,
    })
    expect(!missing.ok && missing.error.code).toBe('photo.notFound')
  })
})
