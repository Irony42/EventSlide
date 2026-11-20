import { describe, expect, it } from 'vitest'
import { asEventId } from '../../domain/shared/ids'
import {
  aBinding,
  channelBindingRepositoryContract,
} from './contracts/channelBindingRepositoryContract'
import { channelCursorStoreContract } from './contracts/channelCursorStoreContract'
import {
  aJob,
  channelMediaJobRepositoryContract,
} from './contracts/channelMediaJobRepositoryContract'
import { FakeChannelBindingRepository } from './fakeChannelBindingRepository'
import { FakeChannelCursorStore } from './fakeChannelCursorStore'
import { FakeChannelMediaJobRepository } from './fakeChannelMediaJobRepository'

channelBindingRepositoryContract('fake', async () => {
  const repo = new FakeChannelBindingRepository()
  return { repo, purgeEvent: async (eventId) => repo.removeEvent(eventId) }
})

channelMediaJobRepositoryContract('fake', async () => {
  const jobs = new FakeChannelMediaJobRepository()
  return { jobs, purgeEvent: async (eventId) => jobs.removeEvent(eventId) }
})

channelCursorStoreContract('fake', async () => ({ store: new FakeChannelCursorStore() }))

describe('the channel fakes', () => {
  it('keep a job’s event out of another event’s purge', async () => {
    const jobs = new FakeChannelMediaJobRepository()
    await jobs.enqueue(aJob({ eventId: asEventId('evt-gala') }))

    jobs.removeEvent(asEventId('evt-wedding'))

    expect(await jobs.countPending(asEventId('evt-gala'))).toBe(1)
  })

  it('refuse, as the unique index does, a binding of one conversation that is also active elsewhere', async () => {
    const repo = new FakeChannelBindingRepository()
    await repo.save(aBinding({ id: 'bnd-1' }))

    const refused = await repo.save(aBinding({ id: 'bnd-2' }))
    expect(refused.ok ? null : refused.error.code).toBe('channel.conversationTaken')
  })
})
