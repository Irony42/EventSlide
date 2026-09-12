import { beforeEach, describe, expect, it } from 'vitest'
import { asClipJobId, asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import { aClipJob } from '../../testing/builders'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { makeGetClipJob, type GetClipJob } from './getClipJob'

/**
 * "Where is my clip?" — the one question a guest has during the window between the
 * upload and the transcode, when there is deliberately no photo row to show them.
 */

const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')
const LEA = { kind: 'guest', guestId: asGuestId('guest-1') } as const
const NILS = { kind: 'guest', guestId: asGuestId('guest-2') } as const
const HOST = { kind: 'host', userId: asUserId('user-1') } as const

describe('getClipJob', () => {
  let clips: FakeClipJobRepository
  let getClipJob: GetClipJob

  beforeEach(() => {
    clips = new FakeClipJobRepository()
    getClipJob = makeGetClipJob({ clips })
  })

  it('tells a guest where their own clip has got to', async () => {
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'running' }))

    const result = await getClipJob({
      eventId: WEDDING,
      clipJobId: asClipJobId('job-1'),
      actor: LEA,
    })

    expect(result.ok && result.value.status).toBe('running')
    expect(result.ok && result.value.photoId).toBe('job-1-photo')
  })

  it('names the row the clip will become, so a client can start watching for it', async () => {
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'done' }))

    const result = await getClipJob({
      eventId: WEDDING,
      clipJobId: asClipJobId('job-1'),
      actor: LEA,
    })

    expect(result.ok && result.value.photoId).toBe('job-1-photo')
  })

  it('carries the stable code behind a refusal, never a French sentence', async () => {
    clips.seed(
      aClipJob({
        id: 'job-1',
        eventId: 'event-1',
        status: 'failed',
        failureCode: 'clip.noVideoStream',
      }),
    )

    const result = await getClipJob({
      eventId: WEDDING,
      clipJobId: asClipJobId('job-1'),
      actor: LEA,
    })

    expect(result.ok && result.value.failureCode).toBe('clip.noVideoStream')
  })

  it('answers not-found for a clip that does not exist', async () => {
    const result = await getClipJob({
      eventId: WEDDING,
      clipJobId: asClipJobId('nope'),
      actor: LEA,
    })

    expect(!result.ok && result.error.code).toBe('clipJob.notFound')
  })

  it('cannot be used to look into another event', async () => {
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1' }))

    const result = await getClipJob({
      eventId: GALA,
      clipJobId: asClipJobId('job-1'),
      actor: LEA,
    })

    expect(!result.ok && result.error.code).toBe('clipJob.notFound')
  })

  it('answers not-found — never forbidden — for another guest’s clip', async () => {
    // A 403 would confirm that this id names a real clip, and these ids are handed out
    // to phones.
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1' }))

    const result = await getClipJob({
      eventId: WEDDING,
      clipJobId: asClipJobId('job-1'),
      actor: NILS,
    })

    expect(!result.ok && result.error.kind).toBe('notFound')
  })

  it('lets a host see any clip in their own event', async () => {
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1' }))

    const result = await getClipJob({
      eventId: WEDDING,
      clipJobId: asClipJobId('job-1'),
      actor: HOST,
    })

    expect(result.ok).toBe(true)
  })
})
