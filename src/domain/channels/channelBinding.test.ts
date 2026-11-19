import { describe, expect, it } from 'vitest'

import { asChannelBindingId, asEventId } from '../shared/ids'
import {
  ChannelBinding,
  cleanConversationTitle,
  decideBinding,
  type BindRequest,
} from './channelBinding'

const NOW = new Date('2026-11-19T20:00:00Z')
const LATER = new Date('2026-11-19T22:00:00Z')
const EVENT = asEventId('evt-1')
const OTHER = asEventId('evt-2')

const binding = (title: string | null = 'Mariage Léa & Tom'): ChannelBinding => {
  const created = ChannelBinding.create(
    { eventId: EVENT, channel: 'telegram', conversationRef: '-100123', conversationTitle: title },
    asChannelBindingId('bnd-1'),
    NOW,
  )
  if (!created.ok) throw new Error('expected a binding')
  return created.value
}

describe('ChannelBinding', () => {
  it('starts active, on the event and the conversation it was made for', () => {
    const created = binding()
    expect(created.isActive()).toBe(true)
    expect(created.eventId).toBe(EVENT)
    expect(created.channel).toBe('telegram')
    expect(created.conversationRef).toBe('-100123')
    expect(created.conversationTitle).toBe('Mariage Léa & Tom')
    expect(created.boundAt).toBe(NOW)
    expect(created.unboundAt).toBeNull()
    expect(created.receivedCount).toBe(0)
    expect(created.id).toBe('bnd-1')
  })

  it('refuses a conversation with no identifier', () => {
    const created = ChannelBinding.create(
      { eventId: EVENT, channel: 'telegram', conversationRef: '  ', conversationTitle: null },
      asChannelBindingId('bnd-1'),
      NOW,
    )
    expect(created.ok).toBe(false)
    if (!created.ok) expect(created.error.code).toBe('channel.conversationMissing')
  })

  it('keeps a title on one line and within 80 characters', () => {
    expect(cleanConversationTitle('  a\nb  ')).toBe('a b')
    expect(cleanConversationTitle('é'.repeat(200))).toBe('é'.repeat(ChannelBinding.maxTitleLength))
    expect(cleanConversationTitle(null)).toBe('')
  })

  it('stops being active when unbound, and keeps the first instant when unbound twice', () => {
    const unbound = binding().unbind(NOW)
    expect(unbound.isActive()).toBe(false)
    expect(unbound.unbind(LATER).unboundAt).toBe(NOW)
  })

  it('follows a conversation that changed identifier', () => {
    const moved = binding().moveTo('-100999')
    expect(moved.ok && moved.value.conversationRef).toBe('-100999')
  })

  it('does not move an unbound link, nor to an empty identifier', () => {
    const ended = binding().unbind(NOW).moveTo('-100999')
    expect(!ended.ok && ended.error.code).toBe('channel.bindingNotActive')
    const empty = binding().moveTo('')
    expect(!empty.ok && empty.error.code).toBe('channel.conversationMissing')
  })

  it('restores a stored binding as it was', () => {
    const stored = binding().unbind(NOW)
    const restored = ChannelBinding.restore({
      id: stored.id,
      eventId: stored.eventId,
      channel: stored.channel,
      conversationRef: stored.conversationRef,
      conversationTitle: stored.conversationTitle,
      boundAt: stored.boundAt,
      unboundAt: stored.unboundAt,
      receivedCount: 7,
    })
    expect(restored.isActive()).toBe(false)
    expect(restored.receivedCount).toBe(7)
    expect(restored.toProps()).toEqual({ ...stored.toProps(), receivedCount: 7 })
  })
})

describe('decideBinding', () => {
  const request = (patch: Partial<BindRequest> = {}): BindRequest => ({
    eventId: EVENT,
    eventAcceptsGuests: true,
    channelAllowed: true,
    existing: null,
    ...patch,
  })
  const existing = (eventId = OTHER, eventIsLive = true): BindRequest['existing'] => ({
    id: asChannelBindingId('bnd-old'),
    eventId,
    eventIsLive,
  })

  it('binds a free conversation to an open event', () => {
    expect(decideBinding(request())).toEqual({ ok: true, value: { kind: 'bind' } })
  })

  it('refuses when the switch or the client ceiling says no', () => {
    const decision = decideBinding(request({ channelAllowed: false }))
    expect(!decision.ok && decision.error.code).toBe('channel.notAllowed')
  })

  it('refuses an event that does not accept guests (closed, archived, unreachable)', () => {
    const decision = decideBinding(request({ eventAcceptsGuests: false }))
    expect(!decision.ok && decision.error.code).toBe('channel.eventNotOpen')
  })

  it('says "not allowed" before "not open", so a plan that excludes it reveals nothing of the event', () => {
    const decision = decideBinding(request({ channelAllowed: false, eventAcceptsGuests: false }))
    expect(!decision.ok && decision.error.code).toBe('channel.notAllowed')
  })

  it('leaves a conversation already bound to this event as it is', () => {
    expect(decideBinding(request({ existing: existing(EVENT) }))).toEqual({
      ok: true,
      value: { kind: 'unchanged', bindingId: 'bnd-old' },
    })
  })

  it('refuses a conversation bound to another event that is still live', () => {
    const decision = decideBinding(request({ existing: existing(OTHER, true) }))
    expect(!decision.ok && decision.error.code).toBe('channel.alreadyBound')
  })

  it('replaces the binding to another event that is over', () => {
    expect(decideBinding(request({ existing: existing(OTHER, false) }))).toEqual({
      ok: true,
      value: { kind: 'replace', replacedId: 'bnd-old' },
    })
  })
})
