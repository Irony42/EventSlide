import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asChannelBindingId, asChannelMediaJobId, asEventId } from '../../../domain/shared/ids'
import type {
  ChannelMediaJobRepository,
  NewChannelMediaJob,
} from '../../ports/channelMediaJobRepository'
import { AT, atPlus } from '../builders'

/**
 * The shared `ChannelMediaJobRepository` contract (spec 27).
 *
 * What the queue promises: one job per message however many times the update arrives, one worker
 * taking the oldest due job, a retry that waits, a crash that puts running jobs back, and a sender's
 * name that is forgotten once the job is over. And that a purge takes the queue with the event.
 */

/** The subject holds these events and one binding per event (the jobs reference both). */
export const CHANNEL_JOB_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  bindings: [
    { id: 'bnd-wedding', eventId: 'evt-wedding' },
    { id: 'bnd-gala', eventId: 'evt-gala' },
  ],
} as const

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

export const aJob = (
  input: {
    readonly id?: string
    readonly eventId?: typeof WEDDING
    readonly messageRef?: string
    readonly senderKey?: string
    readonly createdAt?: Date
  } = {},
): NewChannelMediaJob => {
  const eventId = input.eventId ?? WEDDING
  return {
    id: asChannelMediaJobId(input.id ?? 'job-1'),
    eventId,
    bindingId: asChannelBindingId(eventId === WEDDING ? 'bnd-wedding' : 'bnd-gala'),
    channel: 'telegram',
    conversationRef: '-1001',
    messageRef: input.messageRef ?? 'm-1',
    senderKey: input.senderKey ?? 'k-lea',
    senderName: 'Léa Martin',
    kind: 'photo',
    fileRef: 'file-abc',
    declaredBytes: 1_234,
    durationMs: null,
    declaredName: 'photo.jpg',
    declaredMimeType: null,
    createdAt: input.createdAt ?? AT,
  }
}

export interface ChannelMediaJobSubject {
  readonly jobs: ChannelMediaJobRepository
  /** Purges one event as the box does: its jobs go with it. */
  readonly purgeEvent: (eventId: typeof WEDDING) => Promise<void>
  readonly dispose?: () => Promise<void>
}

export const channelMediaJobRepositoryContract = (
  name: string,
  makeSubject: () => Promise<ChannelMediaJobSubject>,
): void => {
  describe(`ChannelMediaJobRepository contract: ${name}`, () => {
    let subject: ChannelMediaJobSubject
    let jobs: ChannelMediaJobRepository

    beforeEach(async () => {
      subject = await makeSubject()
      jobs = subject.jobs
    })

    afterEach(async () => {
      await subject.dispose?.()
    })

    const idOf = (value: string) => asChannelMediaJobId(value)

    it('queues a job untried and available at once', async () => {
      expect(await jobs.enqueue(aJob())).toBe('queued')

      const found = await jobs.findById(WEDDING, idOf('job-1'))
      expect(found).toMatchObject({
        status: 'queued',
        attempts: 0,
        failureCode: null,
        senderName: 'Léa Martin',
        senderKey: 'k-lea',
        kind: 'photo',
        fileRef: 'file-abc',
        declaredBytes: 1_234,
        durationMs: null,
        declaredName: 'photo.jpg',
        declaredMimeType: null,
      })
      expect(found?.availableAt).toEqual(AT)
    })

    it('takes a message once, however many times its update arrives', async () => {
      await jobs.enqueue(aJob({ id: 'job-1' }))

      expect(await jobs.enqueue(aJob({ id: 'job-2' }))).toBe('duplicate')
      expect(await jobs.findById(WEDDING, idOf('job-2'))).toBeNull()
    })

    it('still calls it a duplicate once the first job is over', async () => {
      await jobs.enqueue(aJob({ id: 'job-1' }))
      await jobs.claimNext(AT)
      await jobs.finish(idOf('job-1'), { status: 'done' }, atPlus(1_000))

      expect(await jobs.enqueue(aJob({ id: 'job-2' }))).toBe('duplicate')
    })

    it('finds a job inside its own event only', async () => {
      await jobs.enqueue(aJob())

      expect(await jobs.findById(GALA, idOf('job-1'))).toBeNull()
    })

    it('hands out the oldest due job and marks it running', async () => {
      await jobs.enqueue(aJob({ id: 'job-b', messageRef: 'm-b', createdAt: atPlus(2_000) }))
      await jobs.enqueue(aJob({ id: 'job-a', messageRef: 'm-a', createdAt: atPlus(1_000) }))

      const first = await jobs.claimNext(atPlus(5_000))
      const second = await jobs.claimNext(atPlus(5_000))
      const none = await jobs.claimNext(atPlus(5_000))

      expect(first?.id).toBe('job-a')
      expect(first?.status).toBe('running')
      expect(first?.updatedAt).toEqual(atPlus(5_000))
      expect(second?.id).toBe('job-b')
      expect(none).toBeNull()
    })

    it('breaks a tie on the instant by ascending id', async () => {
      await jobs.enqueue(aJob({ id: 'job-2', messageRef: 'm-2' }))
      await jobs.enqueue(aJob({ id: 'job-1', messageRef: 'm-1' }))

      expect((await jobs.claimNext(atPlus(1_000)))?.id).toBe('job-1')
    })

    it('does not hand out a job before it is available', async () => {
      await jobs.enqueue(aJob({ createdAt: atPlus(10_000) }))

      expect(await jobs.claimNext(atPlus(9_999))).toBeNull()
      expect((await jobs.claimNext(atPlus(10_000)))?.id).toBe('job-1')
    })

    it('puts a taken job back after a failure, one attempt older, and makes it wait', async () => {
      await jobs.enqueue(aJob())
      await jobs.claimNext(atPlus(1_000))

      await jobs.retryLater(idOf('job-1'), atPlus(2_000), atPlus(62_000))

      const waiting = await jobs.findById(WEDDING, idOf('job-1'))
      expect(waiting).toMatchObject({ status: 'queued', attempts: 1 })
      expect(await jobs.claimNext(atPlus(61_999))).toBeNull()
      expect((await jobs.claimNext(atPlus(62_000)))?.attempts).toBe(1)
    })

    it('only retries a job that is running', async () => {
      await jobs.enqueue(aJob())

      await jobs.retryLater(idOf('job-1'), atPlus(1_000), atPlus(9_000))

      expect(await jobs.findById(WEDDING, idOf('job-1'))).toMatchObject({
        status: 'queued',
        attempts: 0,
      })
    })

    it('finishes a job as done and forgets the sender’s name', async () => {
      await jobs.enqueue(aJob())
      await jobs.claimNext(AT)

      await jobs.finish(idOf('job-1'), { status: 'done' }, atPlus(3_000))

      expect(await jobs.findById(WEDDING, idOf('job-1'))).toMatchObject({
        status: 'done',
        failureCode: null,
        senderName: null,
        senderKey: 'k-lea',
      })
    })

    it('finishes a job as failed with its code, and forgets the name too', async () => {
      await jobs.enqueue(aJob())
      await jobs.claimNext(AT)

      await jobs.finish(
        idOf('job-1'),
        { status: 'failed', failureCode: 'channel.mediaTooLarge' },
        AT,
      )

      expect(await jobs.findById(WEDDING, idOf('job-1'))).toMatchObject({
        status: 'failed',
        failureCode: 'channel.mediaTooLarge',
        senderName: null,
      })
    })

    it('does not mind finishing a job that is gone', async () => {
      await expect(jobs.finish(idOf('job-x'), { status: 'done' }, AT)).resolves.toBeUndefined()
    })

    it('puts back what a crashed process left running, with its attempts', async () => {
      await jobs.enqueue(aJob({ id: 'job-1', messageRef: 'm-1' }))
      await jobs.enqueue(aJob({ id: 'job-2', messageRef: 'm-2' }))
      await jobs.claimNext(atPlus(1_000))

      expect(await jobs.recoverAbandoned(atPlus(2_000))).toBe(1)
      expect(await jobs.recoverAbandoned(atPlus(3_000))).toBe(0)

      expect((await jobs.claimNext(atPlus(4_000)))?.id).toBe('job-1')
    })

    it('counts what is still on its way, per event', async () => {
      await jobs.enqueue(aJob({ id: 'job-1', messageRef: 'm-1' }))
      await jobs.enqueue(aJob({ id: 'job-2', messageRef: 'm-2' }))
      await jobs.enqueue(aJob({ id: 'job-3', messageRef: 'm-3' }))
      await jobs.enqueue(aJob({ id: 'job-4', messageRef: 'm-4', eventId: GALA }))
      await jobs.claimNext(AT)
      await jobs.claimNext(AT)
      await jobs.finish(idOf('job-2'), { status: 'done' }, AT)

      expect(await jobs.countPending(WEDDING)).toBe(2)
      expect(await jobs.countPending(GALA)).toBe(1)
    })

    it('takes back everything one sender has on its way, in one event only', async () => {
      await jobs.enqueue(aJob({ id: 'job-1', messageRef: 'm-1', senderKey: 'k-lea' }))
      await jobs.enqueue(aJob({ id: 'job-2', messageRef: 'm-2', senderKey: 'k-tom' }))
      await jobs.enqueue(
        aJob({ id: 'job-3', messageRef: 'm-3', senderKey: 'k-lea', eventId: GALA }),
      )
      await jobs.claimNext(AT)
      await jobs.finish(idOf('job-1'), { status: 'done' }, AT)

      expect(await jobs.deleteBySender(WEDDING, 'k-lea')).toBe(1)

      expect(await jobs.findById(WEDDING, idOf('job-1'))).toBeNull()
      expect(await jobs.findById(WEDDING, idOf('job-2'))).not.toBeNull()
      expect(await jobs.findById(GALA, idOf('job-3'))).not.toBeNull()
    })

    it('sweeps the jobs that are over and old enough, and leaves the rest', async () => {
      await jobs.enqueue(aJob({ id: 'job-done', messageRef: 'm-1' }))
      await jobs.enqueue(aJob({ id: 'job-failed', messageRef: 'm-2' }))
      await jobs.enqueue(aJob({ id: 'job-new', messageRef: 'm-3' }))
      await jobs.enqueue(aJob({ id: 'job-queued', messageRef: 'm-4', createdAt: atPlus(50_000) }))
      await jobs.claimNext(AT)
      await jobs.claimNext(AT)
      await jobs.finish(idOf('job-done'), { status: 'done' }, atPlus(1_000))
      await jobs.finish(idOf('job-failed'), { status: 'failed', failureCode: 'x' }, atPlus(2_000))
      await jobs.claimNext(atPlus(9_000))
      await jobs.finish(idOf('job-new'), { status: 'done' }, atPlus(9_000))

      expect(await jobs.deleteFinishedBefore(atPlus(2_001))).toBe(2)

      expect(await jobs.findById(WEDDING, idOf('job-done'))).toBeNull()
      expect(await jobs.findById(WEDDING, idOf('job-failed'))).toBeNull()
      expect(await jobs.findById(WEDDING, idOf('job-new'))).not.toBeNull()
      expect(await jobs.findById(WEDDING, idOf('job-queued'))).not.toBeNull()
    })

    it('does not sweep a job exactly at the cutoff', async () => {
      await jobs.enqueue(aJob())
      await jobs.claimNext(AT)
      await jobs.finish(idOf('job-1'), { status: 'done' }, atPlus(1_000))

      expect(await jobs.deleteFinishedBefore(atPlus(1_000))).toBe(0)
    })

    it('goes with its event when the event is purged', async () => {
      await jobs.enqueue(aJob({ id: 'job-1', messageRef: 'm-1' }))
      await jobs.enqueue(aJob({ id: 'job-2', messageRef: 'm-2', eventId: GALA }))

      await subject.purgeEvent(WEDDING)

      expect(await jobs.findById(WEDDING, idOf('job-1'))).toBeNull()
      expect(await jobs.findById(GALA, idOf('job-2'))).not.toBeNull()
    })
  })
}
