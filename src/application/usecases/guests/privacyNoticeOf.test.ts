import { describe, expect, it } from 'vitest'
import type { ClientCeilingsProps } from '../../../domain/clients/clientCeilings'
import { privacyNoticeFor } from '../../../domain/privacy/privacyNotice'
import { aClient, anEvent, anEventSettings } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { privacyNoticeOf } from './privacyNoticeOf'

/**
 * The retention a guest is told is the retention the box applies (roadmap §5.1 / §10.5).
 */

const world = (ceilings: Partial<ClientCeilingsProps>, retentionDays: number | null) => {
  const clients = new FakeClientRepository().seed(aClient({ id: 'client-1', ceilings }))
  const events = new FakeEventRepository({ clients })
  const event = anEvent({ id: 'event-1', clientId: 'client-1', settings: { retentionDays } })
  events.seed(event)
  return { clients, event }
}

describe('privacyNoticeOf', () => {
  it('is the notice of the event’s own settings for an event with no client', async () => {
    const event = anEvent({ settings: { retentionDays: null } })

    const notice = await privacyNoticeOf(new FakeClientRepository(), event, null)

    expect(notice).toEqual(privacyNoticeFor(event.settings))
    expect(notice.retentionDays).toBeNull()
  })

  it('says “kept for ever” is not what happens: an event kept for ever under a ceiling is told its ceiling', async () => {
    const { clients, event } = world({ maxRetentionDays: 30 }, null)

    expect((await privacyNoticeOf(clients, event, null)).retentionDays).toBe(30)
  })

  it('says the ceiling when the host’s own retention is longer than it', async () => {
    const { clients, event } = world({ maxRetentionDays: 30 }, 90)

    expect((await privacyNoticeOf(clients, event, null)).retentionDays).toBe(30)
  })

  it('keeps the host’s retention when it is already the shorter', async () => {
    const { clients, event } = world({ maxRetentionDays: 30 }, 7)

    expect((await privacyNoticeOf(clients, event, null)).retentionDays).toBe(7)
  })

  it('leaves retention as the host set it for a client with no ceiling on it', async () => {
    const { clients, event } = world({ maxTotalBytes: 1_000 }, null)

    expect((await privacyNoticeOf(clients, event, null)).retentionDays).toBeNull()
  })

  it('carries every other clause of the notice through unchanged', async () => {
    const { clients, event } = world({ maxRetentionDays: 30 }, null)

    const notice = await privacyNoticeOf(clients, event, null)

    expect(notice).toEqual(
      privacyNoticeFor(anEventSettings({ ...event.settings.toProps(), retentionDays: 30 })),
    )
  })

  it('gives a different revision when the ceiling changes what is promised, so guests are asked again', async () => {
    const lowered = world({ maxRetentionDays: 14 }, null)
    const raised = world({ maxRetentionDays: 30 }, null)

    expect((await privacyNoticeOf(lowered.clients, lowered.event, null)).revision).not.toBe(
      (await privacyNoticeOf(raised.clients, raised.event, null)).revision,
    )
  })

  describe('the operator (roadmap G2-17)', () => {
    const OPERATOR = 'Association Les Photographes'

    it('names the operator in the notice of an event with no client', async () => {
      const event = anEvent({ settings: { retentionDays: 30 } })

      const notice = await privacyNoticeOf(new FakeClientRepository(), event, OPERATOR)

      expect(notice).toEqual(privacyNoticeFor(event.settings, OPERATOR))
    })

    it('names the operator in the notice of an event whose client puts a ceiling on it', async () => {
      // The second branch builds the notice from a clamped policy, and is the one a hosted
      // instance with clients takes: the operator must not be dropped on the way.
      const { clients, event } = world({ maxRetentionDays: 30 }, null)

      const notice = await privacyNoticeOf(clients, event, OPERATOR)

      expect(notice.operator).toBe(OPERATOR)
      expect(notice.retentionDays).toBe(30)
      expect(notice.revision).toBe(
        (await privacyNoticeOf(clients, event, null)).revision + ';operator=' + OPERATOR,
      )
    })

    it('names nobody when the box named nobody, with or without a client', async () => {
      const bare = anEvent({ settings: { retentionDays: 30 } })
      const { clients, event } = world({ maxRetentionDays: 30 }, null)

      expect((await privacyNoticeOf(new FakeClientRepository(), bare, null)).operator).toBeNull()
      expect((await privacyNoticeOf(clients, event, null)).operator).toBeNull()
    })
  })
})
