import { beforeEach, describe, expect, it } from 'vitest'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { asEventId } from '../../../domain/shared/ids'
import { anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { makeGetEventBySlug, type GetEventBySlug } from './getEventBySlug'

const WEDDING = asEventId('evt-wedding')

describe('getEventBySlug', () => {
  let events: FakeEventRepository
  let getEventBySlug: GetEventBySlug

  beforeEach(() => {
    events = new FakeEventRepository()
    getEventBySlug = makeGetEventBySlug({ events })
  })

  it('resolves the slug to its event', async () => {
    events.seed(anEvent({ id: WEDDING, slug: 'camille-et-sacha' }))

    const result = await getEventBySlug({ slug: 'camille-et-sacha' })

    expect(result.ok && result.value.id).toBe(WEDDING)
  })

  it('never resolves to a neighbouring event on the same box', async () => {
    events.seed(
      anEvent({ id: WEDDING, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
      anEvent({ id: 'evt-gala', slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    )

    const result = await getEventBySlug({ slug: 'gala-annuel' })

    expect(result.ok && result.value.id).toBe(asEventId('evt-gala'))
  })

  /**
   * Status-blind on purpose. The host sets a `draft` event up the day before and reads
   * an `archived` album the week after; a lifecycle check here would lock them out of
   * their own console. What a *guest* may reach is `resolveJoinCode`'s question.
   */
  it.each<EventStatus>(['draft', 'live', 'closed', 'archived'])(
    'resolves a %s event, because the console must reach it at every stage',
    async (status) => {
      events.seed(anEvent({ id: WEDDING, slug: 'camille-et-sacha', status }))

      const result = await getEventBySlug({ slug: 'camille-et-sacha' })

      expect(result.ok && result.value.id).toBe(WEDDING)
    },
  )

  it('answers event.notFound for a slug no event holds', async () => {
    const result = await getEventBySlug({ slug: 'camille-et-sacha' })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  /**
   * A string that could never be a slug gets the same answer as a slug nobody took, so
   * the resolver never sorts real slugs from unreal ones for a caller.
   */
  it('answers event.notFound for a string that is not slug-shaped', async () => {
    const result = await getEventBySlug({ slug: 'Camille & Sacha' })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('reports a missing event as notFound, which the HTTP layer answers with a 404', async () => {
    const result = await getEventBySlug({ slug: 'camille-et-sacha' })

    expect(!result.ok && result.error.kind).toBe('notFound')
  })
})
