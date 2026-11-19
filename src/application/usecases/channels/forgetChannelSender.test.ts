import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'
import { aGuest } from '../../testing/builders'
import { aChannelScene, aMedia, aSender } from '../../testing/channelScene'

const EVENT = asEventId('event-1')

describe('forgetChannelSender', () => {
  it('passes a refusal of the erasure on, instead of saying it is done', async () => {
    const scene = aChannelScene()
    await scene.guests.save(
      aGuest({
        id: 'guest-lea',
        eventId: 'event-1',
        channelIdentity: { channel: 'telegram', senderKey: 'key:telegram:42' },
      }),
    )
    scene.answerErase(err(DomainError.notFound('event.notFound')))

    const result = await scene.forgetChannelSender({
      eventId: EVENT,
      channel: 'telegram',
      sender: aSender(),
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('takes back the jobs of that sender only, even when the sender is no guest yet', async () => {
    const scene = aChannelScene()
    await scene.bindNow()
    await scene.receive(aMedia({ messageRef: 'a' }))
    await scene.receive(aMedia({ messageRef: 'b', sender: aSender({ ref: '43' }) }))

    const result = await scene.forgetChannelSender({
      eventId: EVENT,
      channel: 'telegram',
      sender: aSender(),
    })

    expect(result.ok).toBe(true)
    expect(await scene.jobs.countPending(EVENT)).toBe(1)
    expect(scene.erased).toEqual([])
  })
})
