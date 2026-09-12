import { beforeEach, describe, expect, it } from 'vitest'
import { makeWithdrawReaction, type WithdrawReaction } from './withdrawReaction'
import { asEventId, asGuestId, asPhotoId } from '../../../domain/shared/ids'
import { aReaction } from '../../testing/builders'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'

const EVENT = asEventId('event-1')
const PHOTO = asPhotoId('photo-1')
const GUEST = asGuestId('guest-1')

describe('withdrawReaction', () => {
  let reactions: FakeReactionRepository
  let withdrawReaction: WithdrawReaction

  beforeEach(() => {
    reactions = new FakeReactionRepository()
    withdrawReaction = makeWithdrawReaction({ reactions })
  })

  it('removes a reaction the guest sent', async () => {
    reactions.seed(aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1' }))

    const result = await withdrawReaction({
      eventId: EVENT,
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'love',
    })

    expect(result.ok).toBe(true)
    expect(await reactions.findOne(EVENT, PHOTO, GUEST, 'love')).toBeNull()
  })

  it('leaves the guest other kinds on the same photo alone', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1', kind: 'love' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-1', guestId: 'guest-1', kind: 'clap' }),
    )

    await withdrawReaction({ eventId: EVENT, photoId: PHOTO, guestId: GUEST, kind: 'love' })

    expect(await reactions.findOne(EVENT, PHOTO, GUEST, 'clap')).not.toBeNull()
  })

  it('refuses a kind outside the closed set', async () => {
    const result = await withdrawReaction({
      eventId: EVENT,
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'rocket',
    })

    expect(!result.ok && result.error.code).toBe('reaction.kindUnknown')
  })

  it('reports nothing to withdraw rather than pretending it succeeded', async () => {
    const result = await withdrawReaction({
      eventId: EVENT,
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'love',
    })

    expect(!result.ok && result.error.code).toBe('reaction.notFound')
  })

  it('cannot withdraw another guest reaction', async () => {
    reactions.seed(aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-2' }))

    const result = await withdrawReaction({
      eventId: EVENT,
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'love',
    })

    expect(!result.ok && result.error.code).toBe('reaction.notFound')
  })

  it('leaves another guest reaction in place', async () => {
    reactions.seed(aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-2' }))

    await withdrawReaction({ eventId: EVENT, photoId: PHOTO, guestId: GUEST, kind: 'love' })

    expect(await reactions.findOne(EVENT, PHOTO, asGuestId('guest-2'), 'love')).not.toBeNull()
  })

  it('cannot withdraw a reaction held under another event', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-1', eventId: 'event-2', photoId: 'photo-1', guestId: 'guest-1' }),
    )

    const result = await withdrawReaction({
      eventId: EVENT,
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'love',
    })

    expect(!result.ok && result.error.code).toBe('reaction.notFound')
  })

  it('leaves a reaction held under another event in place', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-1', eventId: 'event-2', photoId: 'photo-1', guestId: 'guest-1' }),
    )

    await withdrawReaction({ eventId: EVENT, photoId: PHOTO, guestId: GUEST, kind: 'love' })

    expect(await reactions.findOne(asEventId('event-2'), PHOTO, GUEST, 'love')).not.toBeNull()
  })
})
