import { describe, expect, it } from 'vitest'
import { asEventId, asGuestId, asPhotoId, asReactionId } from '../shared/ids'
import { Reaction, type NewReaction, type ReactionProps } from './reaction'

const eventId = asEventId('event-mariage')
const photoId = asPhotoId('photo-1')
const guestId = asGuestId('guest-1')
const reactionId = asReactionId('reaction-1')
const now = new Date('2026-06-20T21:30:00.000Z')

const newReaction = (overrides: Partial<NewReaction> = {}): NewReaction => ({
  eventId,
  photoId,
  guestId,
  kind: 'love',
  ...overrides,
})

const storedProps = (overrides: Partial<ReactionProps> = {}): ReactionProps => ({
  id: reactionId,
  eventId,
  photoId,
  guestId,
  kind: 'clap',
  createdAt: now,
  ...overrides,
})

describe('Reaction.create', () => {
  it('takes its identifier from the caller rather than generating one', () => {
    const result = Reaction.create(newReaction(), reactionId, now)

    expect(result.ok && result.value.id).toBe(reactionId)
  })

  it('scopes the reaction to one event, one photo and one guest', () => {
    const result = Reaction.create(newReaction(), reactionId, now)

    expect(result.ok && result.value.eventId).toBe(eventId)
    expect(result.ok && result.value.photoId).toBe(photoId)
    expect(result.ok && result.value.guestId).toBe(guestId)
  })

  it('keeps the kind the guest sent', () => {
    const result = Reaction.create(newReaction({ kind: 'cheers' }), reactionId, now)

    expect(result.ok && result.value.kind).toBe('cheers')
  })

  it('stamps the time it was given instead of reading a clock', () => {
    const result = Reaction.create(newReaction(), reactionId, now)

    expect(result.ok && result.value.createdAt).toBe(now)
  })

  it('refuses a kind outside the closed set', () => {
    const result = Reaction.create(newReaction({ kind: 'aubergine' }), reactionId, now)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('reaction.kindUnknown')
  })

  it('reports an unknown kind as bad input rather than a conflict', () => {
    const result = Reaction.create(newReaction({ kind: '' }), reactionId, now)

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('Reaction.restore', () => {
  it('round-trips every stored field', () => {
    const restored = Reaction.restore(storedProps())

    expect(restored.toProps()).toEqual({
      id: reactionId,
      eventId,
      photoId,
      guestId,
      kind: 'clap',
      createdAt: now,
    })
  })

  it('exposes the stored kind and time through its getters', () => {
    const restored = Reaction.restore(storedProps())

    expect(restored.kind).toBe('clap')
    expect(restored.createdAt).toBe(now)
  })
})

describe('Reaction scope predicates', () => {
  const reaction = Reaction.restore(storedProps())

  it('recognises the guest who sent it', () => {
    expect(reaction.isBy(guestId)).toBe(true)
  })

  it('does not claim a reaction sent by another guest', () => {
    expect(reaction.isBy(asGuestId('guest-2'))).toBe(false)
  })

  it('recognises the photo it belongs to', () => {
    expect(reaction.isFor(photoId)).toBe(true)
  })

  it('does not claim a reaction to another photo', () => {
    expect(reaction.isFor(asPhotoId('photo-2'))).toBe(false)
  })
})
