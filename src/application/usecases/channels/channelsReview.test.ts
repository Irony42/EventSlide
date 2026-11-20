import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../domain/shared/errors'
import { asChannelMediaJobId, asEventId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import { err, ok } from '../../../domain/shared/result'
import { AT, aGuest, anEvent } from '../../testing/builders'
import {
  aChannelScene,
  aCommand,
  aMedia,
  aSender,
  BYTES,
  CONVERSATION,
  type ChannelScene,
} from '../../testing/channelScene'
import { aBinding } from '../../testing/contracts/channelBindingRepositoryContract'
import { MAX_ATTEMPTS, makeDrainChannelMedia } from './drainChannelMedia'
import { makeListBindings } from './listBindings'
import { makeUnbindConversation } from './unbindConversation'

/**
 * What the independent review of the channel's use cases found (spec 27): each rule below was a defect.
 */

const EVENT = asEventId('event-1')
const JOB = asChannelMediaJobId('channel-job-1')
const OWNER = asUserId('user-owner')
const signal = new AbortController().signal
const LEA_KEY = 'key:telegram:event-1:42'

const waiting = async (
  options: Parameters<typeof aChannelScene>[0] = {},
): Promise<ChannelScene> => {
  const scene = aChannelScene(options)
  await scene.bindNow()
  scene.telegram.hold('file-1', BYTES)
  await scene.receive(aMedia())
  return scene
}

describe('/oublier answers what happened', () => {
  it('says it could not remove the photos when the erasure failed, and logs the code', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.guests.save(
      aGuest({
        id: 'guest-lea',
        eventId: 'event-1',
        channelIdentity: { channel: 'telegram', senderKey: LEA_KEY },
      }),
    )
    scene.answerErase(err(DomainError.notFound('event.notFound')))

    expect(await scene.receive(aCommand('forget'))).toBe('answered')

    expect(scene.telegram.said[0]?.text).toContain('pas pu retirer')
    expect(scene.logger.lines.some((line) => line.message === 'channel.forgetFailed')).toBe(true)
  })
})

describe('/oublier by a revoked guest', () => {
  it('erases what they sent but keeps the ban: the next media is still refused', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.guests.save(
      aGuest({
        id: 'guest-lea',
        eventId: 'event-1',
        channelIdentity: { channel: 'telegram', senderKey: LEA_KEY },
      }).revoke(AT),
    )

    await scene.forgetChannelSender({ eventId: EVENT, channel: 'telegram', sender: aSender() })

    expect(scene.erased).toEqual(['guest-lea'])
    const tombstone = await scene.guests.findByChannelSender(EVENT, 'telegram', LEA_KEY)
    expect(tombstone?.isRevoked()).toBe(true)
    expect(tombstone?.displayName).toBeNull()
    expect(await scene.receive(aMedia({ messageRef: 'after' }))).toBe('dropped')
  })

  it('leaves nothing behind for a guest who was not revoked', async () => {
    const scene = aChannelScene()
    await scene.guests.save(
      aGuest({
        id: 'guest-lea',
        eventId: 'event-1',
        channelIdentity: { channel: 'telegram', senderKey: LEA_KEY },
      }),
    )

    await scene.forgetChannelSender({ eventId: EVENT, channel: 'telegram', sender: aSender() })

    expect(await scene.guests.findByChannelSender(EVENT, 'telegram', LEA_KEY)).toBeNull()
  })
})

describe('the erasure and the worker never interleave', () => {
  it('waits for the media being stored before it erases the sender', async () => {
    const scene = await waiting()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const answer = scene.drainDeps.uploadPhotos
    const drain = makeDrainChannelMedia({
      ...scene.drainDeps,
      uploadPhotos: async (input) => {
        await gate
        return answer(input)
      },
    })

    const draining = drain(signal)
    // Let the drain reach the upload, holding the event's lock.
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
    const forgetting = scene.forgetChannelSender({
      eventId: EVENT,
      channel: 'telegram',
      sender: aSender(),
    })
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
    expect(scene.erased).toEqual([])

    release()
    expect(await draining).toBe('stored')
    await forgetting

    // Stored first, erased after: the photograph is not left behind a guest who is gone.
    expect(scene.erased).toHaveLength(1)
  })
})

describe('the drain keeps the queue honest', () => {
  it('tries again later when something throws, and ends the job once the attempts are spent', async () => {
    const scene = await waiting()
    const drain = makeDrainChannelMedia({
      ...scene.drainDeps,
      uploadPhotos: async () => {
        throw new Error('disk gone')
      },
    })

    expect(await drain(signal)).toBe('retry')
    expect(await scene.jobs.findById(EVENT, JOB)).toMatchObject({ status: 'queued', attempts: 1 })

    scene.clock.advance(10 * 60_000)
    expect(await drain(signal)).toBe('retry')
    scene.clock.advance(10 * 60_000)
    expect(await drain(signal)).toBe('skipped')

    expect(await scene.jobs.findById(EVENT, JOB)).toMatchObject({
      status: 'failed',
      failureCode: 'channel.internalError',
    })
    expect(MAX_ATTEMPTS).toBe(3)
    expect(scene.logger.lines.some((line) => line.message === 'channel.media failed')).toBe(true)
  })

  it('also survives something that is not an Error being thrown', async () => {
    const scene = await waiting()
    const drain = makeDrainChannelMedia({
      ...scene.drainDeps,
      uploadPhotos: async () => {
        throw 'not an error'
      },
    })

    expect(await drain(signal)).toBe('retry')
  })

  it('never rethrows, even when the store fails too', async () => {
    const scene = await waiting()
    scene.jobs.retryLater = async () => {
      throw new Error('locked')
    }
    const drain = makeDrainChannelMedia({
      ...scene.drainDeps,
      uploadPhotos: async () => {
        throw new Error('disk gone')
      },
    })

    expect(await drain(signal)).toBe('skipped')
  })

  it('rethrows only at shutdown, leaving the job to be recovered', async () => {
    const scene = await waiting()
    const stopping = new AbortController()
    const drain = makeDrainChannelMedia({
      ...scene.drainDeps,
      uploadPhotos: async () => {
        stopping.abort()
        throw new Error('aborted')
      },
    })

    await expect(drain(stopping.signal)).rejects.toThrow('aborted')
    expect((await scene.jobs.findById(EVENT, JOB))?.status).toBe('running')
  })
})

describe('the switch and the plan are read at every media', () => {
  it('refuses at the drain, once an hour, when the host turned Telegram off since', async () => {
    const scene = await waiting()
    scene.events.seed(anEvent({ id: 'event-1', settings: { allowTelegram: false } }))

    expect(await scene.drain(signal)).toBe('refused')

    expect(await scene.jobs.findById(EVENT, JOB)).toMatchObject({
      failureCode: 'channel.notAllowed',
    })
    expect(scene.telegram.said[0]?.text).toContain('désactivé')
    expect(scene.photoCalls).toEqual([])
  })

  it('refuses at the door, once an hour, queueing nothing', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    scene.events.seed(anEvent({ id: 'event-1', settings: { allowTelegram: false } }))

    expect(await scene.receive(aMedia({ messageRef: 'a' }))).toBe('dropped')
    expect(await scene.receive(aMedia({ messageRef: 'b' }))).toBe('dropped')

    expect(scene.telegram.said).toHaveLength(1)
    expect(await scene.jobs.countPending(EVENT)).toBe(0)
  })
})

describe('a guest is made only for a media that is kept', () => {
  it('leaves no guest behind when the pipeline refuses the media', async () => {
    const scene = await waiting()
    scene.answerPhotos(scene.refusedPhoto('photo.unsupportedType'))

    expect(await scene.drain(signal)).toBe('refused')

    expect(await scene.guestOf()).toBeNull()
  })

  it('leaves no guest behind for a duplicate, which stored nothing for them', async () => {
    const scene = await waiting()
    scene.answerPhotos(
      ok({
        outcomes: [
          { index: 0, declaredName: 'photo.jpg', kind: 'duplicate', photoId: asPhotoId('photo-1') },
        ],
        published: [],
      }),
    )

    expect(await scene.drain(signal)).toBe('duplicate')

    expect(await scene.guestOf()).toBeNull()
  })

  it('keeps a guest who already had contributions when a later media is refused', async () => {
    const scene = await waiting()
    expect(await scene.drain(signal)).toBe('stored')
    scene.telegram.hold('file-2', BYTES)
    await scene.receive(aMedia({ messageRef: 'm-2', fileRef: 'file-2' }))
    scene.answerPhotos(scene.refusedPhoto('photo.unsupportedType'))

    expect(await scene.drain(signal)).toBe('refused')

    expect(await scene.guestOf()).not.toBeNull()
  })
})

describe('the rationing key is the same on both sides', () => {
  it('tells a sender once for a refusal at the door and again at the queue', async () => {
    const scene = aChannelScene({ limits: { mediaPerMinute: 1 } })
    await scene.bindNow()
    scene.telegram.hold('file-1', BYTES)
    await scene.receive(aMedia({ messageRef: 'a' }))
    await scene.receive(aMedia({ messageRef: 'b' }))
    await scene.receive(aMedia({ messageRef: 'c' }))

    // Two media refused as "too fast" at the door: one answer.
    expect(scene.telegram.said.filter((said) => said.text.includes('Doucement'))).toHaveLength(1)
  })
})

describe('a failed save of a binding is not announced', () => {
  it('ignores a move that lost the race for its new identifier', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    scene.bindings.save = async () => err(DomainError.conflict('channel.conversationTaken'))
    scene.bus.clear()

    const outcome = await scene.receive({
      type: 'conversationMoved',
      channel: 'telegram',
      fromRef: CONVERSATION,
      toRef: '-100999',
    })

    expect(outcome).toBe('ignored')
    expect(scene.bus.published).toEqual([])
  })

  it('ignores a removal it could not save', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    scene.bindings.save = async () => err(DomainError.conflict('channel.conversationTaken'))
    scene.bus.clear()

    const outcome = await scene.receive({
      type: 'botRemoved',
      channel: 'telegram',
      conversationRef: CONVERSATION,
    })

    expect(outcome).toBe('ignored')
    expect(scene.bus.published).toEqual([])
  })

  it('reports an unlink it could not save, and says nothing in the group', async () => {
    const scene = aChannelScene({ settings: { wallLanguage: 'en' } })
    await scene.memberships.grant({ eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT })
    await scene.bindNow()
    const binding = await scene.bindings.findActive('telegram', CONVERSATION)
    if (binding === null) throw new Error('binding')
    scene.bindings.save = async () => err(DomainError.conflict('channel.conversationTaken'))
    const unbind = makeUnbindConversation({
      events: scene.events,
      memberships: scene.memberships,
      bindings: scene.bindings,
      channels: scene.channels,
      clock: scene.clock,
      bus: scene.bus,
    })

    const result = await unbind({ eventId: EVENT, actorId: OWNER, bindingId: binding.id })

    expect(!result.ok && result.error.code).toBe('channel.conversationTaken')
    expect(scene.telegram.said).toEqual([])
  })
})

describe('replacing a group connection', () => {
  it('keeps the old link when the new one cannot be saved', async () => {
    const scene = aChannelScene()
    scene.events.seed(
      anEvent({
        id: 'event-2',
        slug: 'gala',
        joinCode: 'Z3N9PT',
        settings: { allowTelegram: true },
      }),
    )
    await scene.bindings.save(aBinding({ id: 'bnd-old', eventId: asEventId('event-2') }))
    scene.events.seed(
      anEvent({ id: 'event-2', slug: 'gala', joinCode: 'Z3N9PT', status: 'closed' }),
    )
    const real = scene.bindings.save.bind(scene.bindings)
    let calls = 0
    scene.bindings.save = async (binding) => {
      calls += 1
      // The unbind of the old one and its restoration go through; the new binding is refused.
      return binding.eventId === EVENT
        ? err(DomainError.conflict('channel.conversationTaken'))
        : real(binding)
    }

    const bound = await scene.bindConversation({
      channel: 'telegram',
      conversationRef: CONVERSATION,
      conversationTitle: 'Mariage',
      code: 'H7K2QM',
    })

    expect(!bound.ok && bound.error.error.code).toBe('channel.alreadyBound')
    expect(calls).toBe(3)
    expect((await scene.bindings.findActive('telegram', CONVERSATION))?.eventId).toBe('event-2')
  })
})

describe('listing the groups of an event', () => {
  it('answers an event the operator took down as one that is not there', async () => {
    const scene = aChannelScene()
    await scene.events.setTakenDown(EVENT, AT)
    await scene.memberships.grant({ eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT })
    const list = makeListBindings({
      events: scene.events,
      clients: scene.clients,
      memberships: scene.memberships,
      bindings: scene.bindings,
      channels: scene.channels,
    })

    const view = await list({ eventId: EVENT, actorId: OWNER })

    expect(!view.ok && view.error.code).toBe('event.notFound')
  })

  it('still lists for a suspended client, which reads and may not write', async () => {
    const scene = aChannelScene({ event: { clientSuspendedAt: AT } })
    await scene.memberships.grant({ eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT })
    const list = makeListBindings({
      events: scene.events,
      clients: scene.clients,
      memberships: scene.memberships,
      bindings: scene.bindings,
      channels: scene.channels,
    })

    expect((await list({ eventId: EVENT, actorId: OWNER })).ok).toBe(true)
  })
})

describe('the unlink does not wait for the group', () => {
  it('answers even when the group never replies', async () => {
    const scene = aChannelScene()
    await scene.memberships.grant({ eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT })
    await scene.bindNow()
    const binding = await scene.bindings.findActive('telegram', CONVERSATION)
    if (binding === null) throw new Error('binding')
    scene.telegram.reply = () => new Promise<void>(() => undefined)
    const unbind = makeUnbindConversation({
      events: scene.events,
      memberships: scene.memberships,
      bindings: scene.bindings,
      channels: scene.channels,
      clock: scene.clock,
      bus: scene.bus,
    })

    expect((await unbind({ eventId: EVENT, actorId: OWNER, bindingId: binding.id })).ok).toBe(true)
  })
})
