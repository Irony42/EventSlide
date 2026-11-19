import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChannelBinding } from '../../../domain/channels/channelBinding'
import { asChannelBindingId, asEventId } from '../../../domain/shared/ids'
import type { ChannelBindingRepository } from '../../ports/channelBindingRepository'
import { AT, atPlus } from '../builders'

/**
 * The shared `ChannelBindingRepository` contract (spec 27).
 *
 * The interesting cases are the ones the schema guards: one active binding per conversation, a
 * binding that cannot be moved to another event, a counter the repository owns, and a purge that
 * takes the bindings with the event (`ON DELETE CASCADE`).
 */

/** `channel_bindings.event_id` references `events`, so a subject must hold both. */
export const CHANNEL_CONTRACT_FIXTURES = { eventIds: ['evt-wedding', 'evt-gala'] } as const

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

export const aBinding = (
  input: {
    readonly id?: string
    readonly eventId?: typeof WEDDING
    readonly conversationRef?: string
    readonly title?: string | null
    readonly boundAt?: Date
  } = {},
): ChannelBinding => {
  const created = ChannelBinding.create(
    {
      eventId: input.eventId ?? WEDDING,
      channel: 'telegram',
      conversationRef: input.conversationRef ?? '-1001',
      conversationTitle: input.title === undefined ? 'Mariage Léa & Tom' : input.title,
    },
    asChannelBindingId(input.id ?? 'bnd-1'),
    input.boundAt ?? AT,
  )
  if (!created.ok) throw new Error('aBinding: the builder produced an invalid binding')
  return created.value
}

export interface ChannelBindingSubject {
  readonly repo: ChannelBindingRepository
  /** Purges one event as the box does: its bindings go with it. */
  readonly purgeEvent: (eventId: typeof WEDDING) => Promise<void>
  readonly dispose?: () => Promise<void>
}

export const channelBindingRepositoryContract = (
  name: string,
  makeSubject: () => Promise<ChannelBindingSubject>,
): void => {
  describe(`ChannelBindingRepository contract: ${name}`, () => {
    let subject: ChannelBindingSubject
    let repo: ChannelBindingRepository

    beforeEach(async () => {
      subject = await makeSubject()
      repo = subject.repo
    })

    afterEach(async () => {
      await subject.dispose?.()
    })

    it('saves a binding and finds it by its conversation', async () => {
      await repo.save(aBinding())

      const found = await repo.findActive('telegram', '-1001')

      expect(found?.id).toBe('bnd-1')
      expect(found?.eventId).toBe(WEDDING)
      expect(found?.conversationTitle).toBe('Mariage Léa & Tom')
      expect(found?.boundAt).toEqual(AT)
      expect(found?.receivedCount).toBe(0)
      expect(found?.isActive()).toBe(true)
    })

    it('finds nothing for a conversation nobody bound', async () => {
      expect(await repo.findActive('telegram', '-404')).toBeNull()
    })

    it('finds a binding by id inside its own event only', async () => {
      await repo.save(aBinding())

      expect((await repo.findById(WEDDING, asChannelBindingId('bnd-1')))?.id).toBe('bnd-1')
      expect(await repo.findById(GALA, asChannelBindingId('bnd-1'))).toBeNull()
    })

    it('holds at most one active binding per conversation', async () => {
      await repo.save(aBinding({ id: 'bnd-1' }))

      await expect(repo.save(aBinding({ id: 'bnd-2', eventId: GALA }))).rejects.toThrow()
      expect((await repo.findActive('telegram', '-1001'))?.id).toBe('bnd-1')
    })

    it('lets a conversation be bound again once its binding ended, and keeps both rows', async () => {
      const ended = aBinding({ id: 'bnd-1' }).unbind(atPlus(1_000))
      await repo.save(aBinding({ id: 'bnd-1' }))
      await repo.save(ended)

      await repo.save(aBinding({ id: 'bnd-2', eventId: GALA, boundAt: atPlus(2_000) }))

      expect((await repo.findActive('telegram', '-1001'))?.id).toBe('bnd-2')
      expect((await repo.findById(WEDDING, asChannelBindingId('bnd-1')))?.unboundAt).toEqual(
        atPlus(1_000),
      )
    })

    it('stops finding a binding once it ended', async () => {
      await repo.save(aBinding())
      await repo.save(aBinding().unbind(atPlus(1_000)))

      expect(await repo.findActive('telegram', '-1001')).toBeNull()
      expect(await repo.listActiveForEvent(WEDDING)).toEqual([])
    })

    it('follows a conversation that changed identifier, and keeps its counter', async () => {
      await repo.save(aBinding())
      await repo.recordReceived(asChannelBindingId('bnd-1'))
      const moved = aBinding().moveTo('-2002')
      if (!moved.ok) throw new Error('moveTo')

      await repo.save(moved.value)

      expect(await repo.findActive('telegram', '-1001')).toBeNull()
      const found = await repo.findActive('telegram', '-2002')
      expect(found?.id).toBe('bnd-1')
      expect(found?.receivedCount).toBe(1)
    })

    it('never moves a binding to another event, even by saving it under the same id', async () => {
      await repo.save(aBinding({ id: 'bnd-1', eventId: WEDDING }))

      await expect(repo.save(aBinding({ id: 'bnd-1', eventId: GALA }))).rejects.toThrow()
      expect((await repo.findById(WEDDING, asChannelBindingId('bnd-1')))?.id).toBe('bnd-1')
    })

    it('counts what a conversation sends, and a save does not reset the count', async () => {
      await repo.save(aBinding())
      await repo.recordReceived(asChannelBindingId('bnd-1'))
      await repo.recordReceived(asChannelBindingId('bnd-1'))

      await repo.save(aBinding({ title: 'Renamed' }))

      const found = await repo.findActive('telegram', '-1001')
      expect(found?.receivedCount).toBe(2)
      expect(found?.conversationTitle).toBe('Renamed')
    })

    it('does not mind counting for a binding that is not there', async () => {
      await expect(repo.recordReceived(asChannelBindingId('bnd-nobody'))).resolves.toBeUndefined()
    })

    it('lists an event’s active bindings, oldest first, and only that event’s', async () => {
      await repo.save(aBinding({ id: 'bnd-b', conversationRef: '-2', boundAt: atPlus(2_000) }))
      await repo.save(aBinding({ id: 'bnd-a', conversationRef: '-1', boundAt: atPlus(1_000) }))
      await repo.save(aBinding({ id: 'bnd-c', conversationRef: '-3', eventId: GALA }))

      const listed = await repo.listActiveForEvent(WEDDING)

      expect(listed.map((binding) => binding.id)).toEqual(['bnd-a', 'bnd-b'])
    })

    it('breaks a tie on the instant of binding by ascending id', async () => {
      await repo.save(aBinding({ id: 'bnd-2', conversationRef: '-2' }))
      await repo.save(aBinding({ id: 'bnd-1', conversationRef: '-1' }))

      expect((await repo.listActiveForEvent(WEDDING)).map((binding) => binding.id)).toEqual([
        'bnd-1',
        'bnd-2',
      ])
    })

    it('goes with its event when the event is purged', async () => {
      await repo.save(aBinding({ id: 'bnd-1', conversationRef: '-1' }))
      await repo.save(aBinding({ id: 'bnd-2', conversationRef: '-2', eventId: GALA }))

      await subject.purgeEvent(WEDDING)

      expect(await repo.findActive('telegram', '-1')).toBeNull()
      expect((await repo.findActive('telegram', '-2'))?.id).toBe('bnd-2')
    })
  })
}
