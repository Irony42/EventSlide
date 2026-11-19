import { describe, expect, it } from 'vitest'
import { asEventId } from '../../../domain/shared/ids'
import { aChannelScene, aMedia, BYTES } from '../../testing/channelScene'
import { CHANNEL_JOB_RETENTION_MS, makeSweepChannelJobs } from './sweepChannelJobs'

const EVENT = asEventId('event-1')
const signal = new AbortController().signal

describe('sweepChannelJobs', () => {
  it('forgets a job that has been over for a day, and keeps one that is younger or still waiting', async () => {
    const scene = aChannelScene({ limits: { mediaPerMinute: 10 } })
    await scene.bindNow()
    scene.telegram.hold('file-1', BYTES)
    const sweep = makeSweepChannelJobs({ jobs: scene.jobs, clock: scene.clock })
    await scene.receive(aMedia({ messageRef: 'old' }))
    await scene.drain(signal)
    scene.clock.advance(CHANNEL_JOB_RETENTION_MS - 1)
    await scene.receive(aMedia({ messageRef: 'young' }))
    await scene.drain(signal)
    await scene.receive(aMedia({ messageRef: 'waiting' }))

    expect(await sweep()).toBe(0)
    scene.clock.advance(2)

    expect(await sweep()).toBe(1)
    expect(await scene.jobs.countPending(EVENT)).toBe(1)
    // The one that is gone is no longer recognised: its message would be taken again.
    expect(await scene.receive(aMedia({ messageRef: 'old' }))).toBe('queued')
  })
})
