import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import type { PhotoActor } from '../../../domain/photos/photo'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { VOICE_VARIANT } from '../../../domain/photos/mediaVariant'
import {
  asEventId,
  asGuestId,
  asGuestbookEntryId,
  asUserId,
  type GuestbookEntryId,
} from '../../../domain/shared/ids'
import { AT, aGuestbookEntry, aVoiceEntry, anEvent, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { makeGetGuestbookVoiceMedia, type GetGuestbookVoiceMedia } from './getGuestbookVoiceMedia'

/**
 * The one door a voice recording has (spec 25, rule 11): every refusal is the use case's, asked on
 * each request, and everything that is not "sealed" or "frozen" is the one `guestbook.notFound`.
 */

const EVENT = asEventId('event-1')
const OTHER_EVENT = asEventId('event-2')
const OWNER = asUserId('user-owner')
const MODERATOR = asUserId('user-moderator')
const STRANGER = asUserId('user-stranger')
const ENTRY = asGuestbookEntryId('v1')

const host = (userId: typeof OWNER): PhotoActor => ({ kind: 'host', userId })
const BYTES = new TextEncoder().encode('a recording, as far as a store is concerned')

describe('getGuestbookVoiceMedia', () => {
  let events: FakeEventRepository
  let guestbook: FakeGuestbookRepository
  let memberships: FakeMembershipRepository
  let media: InMemoryMediaStore
  let clock: FakeClock
  let get: GetGuestbookVoiceMedia

  const seedEvent = (input: Parameters<typeof anEvent>[0] = {}): void => {
    events.seed(
      anEvent({
        id: 'event-1',
        ...input,
        settings: { allowGuestbook: true, guestbookVoice: { enabled: true }, ...input.settings },
      }),
    )
  }

  /** A ready voice with a file behind it, which is what a listener is served. */
  const seedReadyVoice = async (
    input: Parameters<typeof aVoiceEntry>[0] = {},
  ): Promise<GuestbookEntryId> => {
    const entry = aVoiceEntry({ id: 'v1', state: 'ready', eventId: 'event-1', ...input })
    guestbook.seed(entry)
    const hash = entry.voice?.audioHash
    if (hash !== null && hash !== undefined) {
      await media.put(asEventId(entry.eventId), hash, VOICE_VARIANT, BYTES)
    }
    return entry.id
  }

  const run = (
    over: {
      actor?: PhotoActor
      entryId?: GuestbookEntryId
      eventId?: typeof EVENT
    } = {},
  ) => get({ eventId: EVENT, entryId: ENTRY, actor: host(MODERATOR), ...over })

  const codeOf = async (promise: ReturnType<typeof run>): Promise<string | null> => {
    const result = await promise
    return result.ok ? null : result.error.code
  }

  beforeEach(() => {
    events = new FakeEventRepository()
    guestbook = new FakeGuestbookRepository()
    memberships = new FakeMembershipRepository()
    media = new InMemoryMediaStore()
    clock = new FakeClock(AT)
    get = makeGetGuestbookVoiceMedia({ events, guestbook, memberships, media, clock })
    memberships.seed(
      { eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT },
      { eventId: OTHER_EVENT, userId: STRANGER, role: 'owner', grantedAt: AT },
    )
    seedEvent()
  })

  it('serves a moderator the recording, with its size, its type and a way to read a range of it', async () => {
    await seedReadyVoice()

    const result = await run()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.byteSize).toBe(BYTES.length)
    expect(result.value.contentType).toBe('audio/mp4')
    const part = await result.value.open({ start: 2, end: 5 })
    const chunks: Uint8Array[] = []
    for await (const chunk of part ?? []) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toBe('reco')
  })

  it('serves the owner too, who is a moderator and more', async () => {
    await seedReadyVoice()

    expect((await run({ actor: host(OWNER) })).ok).toBe(true)
  })

  it('refuses a guest outright, whoever it is, the author included: the phone listens before it sends', async () => {
    await seedReadyVoice()

    const author = { kind: 'guest', guestId: asGuestId('guest-1') } as const

    expect(await codeOf(run({ actor: author }))).toBe('auth.forbidden')
  })

  it('answers a stranger, a member of another event, exactly as for an event that does not exist', async () => {
    await seedReadyVoice()

    expect(await codeOf(run({ actor: host(STRANGER) }))).toBe('event.notFound')
  })

  it('answers event.notFound for an event nobody holds', async () => {
    expect(await codeOf(run({ eventId: asEventId('nowhere') }))).toBe('event.notFound')
  })

  describe('the sealed secret', () => {
    beforeEach(async () => {
      seedEvent({ settings: { guestbookVoice: { enabled: true, sealed: true } } })
      await seedReadyVoice()
    })

    it('is a 403 guestbook.voiceSealed to a moderator', async () => {
      const result = await run()

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'forbidden',
        'guestbook.voiceSealed',
      ])
    })

    it('is the same refusal to the owner: a rule with an exception for the person who set it is one forgotten laptop away from broken', async () => {
      expect(await codeOf(run({ actor: host(OWNER) }))).toBe('guestbook.voiceSealed')
    })

    it('lifts at the instant the owner opened it, that instant included, and not before', async () => {
      seedEvent({
        settings: {
          guestbookVoice: { enabled: true, sealed: true, opensAtMs: AT.getTime() + 1_000 },
        },
      })

      expect(await codeOf(run())).toBe('guestbook.voiceSealed')
      clock.set(atPlus(1_000))
      expect(await codeOf(run())).toBeNull()
    })

    it.each(['closed', 'archived'] as const)(
      'lifts by itself when the event is %s, which is the end of the evening read literally',
      async (status) => {
        seedEvent({ status, settings: { guestbookVoice: { enabled: true, sealed: true } } })

        expect(await codeOf(run())).toBeNull()
      },
    )

    it('is asked after the message is known to be there and ready, so it cannot be used to probe an id', async () => {
      expect(await codeOf(run({ entryId: asGuestbookEntryId('nobody') }))).toBe(
        'guestbook.notFound',
      )
    })
  })

  describe('the one refusal for everything that is not there to be heard', () => {
    it('is guestbook.notFound for an id nobody holds', async () => {
      expect(await codeOf(run({ entryId: asGuestbookEntryId('nobody') }))).toBe(
        'guestbook.notFound',
      )
    })

    it('is guestbook.notFound for a message of another event, even for one who moderates both', async () => {
      memberships.seed({
        eventId: OTHER_EVENT,
        userId: MODERATOR,
        role: 'moderator',
        grantedAt: AT,
      })
      events.seed(anEvent({ id: 'event-2', slug: 'gala', joinCode: 'ZZ9ZZ9' }))
      const elsewhere = aVoiceEntry({ id: 'v9', state: 'ready', eventId: 'event-2' })
      guestbook.seed(elsewhere)
      await media.put(OTHER_EVENT, elsewhere.voice?.audioHash as ContentHash, VOICE_VARIANT, BYTES)

      expect(await codeOf(run({ entryId: asGuestbookEntryId('v9') }))).toBe('guestbook.notFound')
    })

    it('is guestbook.notFound for a message the operator took down, which the repository never returns', async () => {
      await seedReadyVoice()
      guestbook.takeDown(EVENT, ENTRY, AT)

      expect(await codeOf(run())).toBe('guestbook.notFound')
    })

    it('is guestbook.notFound for a written message, which has nothing to play', async () => {
      guestbook.seed(aGuestbookEntry({ id: 'w1', eventId: 'event-1' }))

      expect(await codeOf(run({ entryId: asGuestbookEntryId('w1') }))).toBe('guestbook.notFound')
    })

    it.each(['reserved', 'queued', 'running', 'failed'] as const)(
      'is guestbook.notFound for a recording that is %s, since only a ready one can be heard',
      async (state) => {
        guestbook.seed(aVoiceEntry({ id: 'v1', state, eventId: 'event-1' }))

        expect(await codeOf(run())).toBe('guestbook.notFound')
      },
    )

    it('is guestbook.notFound when the file is gone, as after a restored backup', async () => {
      guestbook.seed(aVoiceEntry({ id: 'v1', state: 'ready', eventId: 'event-1' }))

      expect(await codeOf(run())).toBe('guestbook.notFound')
    })
  })

  it('is refused 403 client.suspended to the members of a suspended client, as photographs are', async () => {
    await seedReadyVoice()
    events.seed(
      Event.restore({
        ...anEvent({
          id: 'event-1',
          settings: { allowGuestbook: true, guestbookVoice: { enabled: true } },
        }).toProps(),
        clientSuspendedAt: AT,
      }),
    )

    const result = await run()

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'forbidden',
      'client.suspended',
    ])
  })

  it('is event.notFound once the operator took the event down, to its members too', async () => {
    await seedReadyVoice()
    await events.setTakenDown(EVENT, AT)

    expect(await codeOf(run())).toBe('event.notFound')
  })

  it('still serves what is already there once the voice is switched off, or the book closed to new messages', async () => {
    await seedReadyVoice()
    seedEvent({ settings: { allowGuestbook: false, guestbookVoice: { enabled: false } } })

    expect(await codeOf(run())).toBeNull()
  })

  it('judges again on every request: a recording the operator takes down mid-listen is no longer served', async () => {
    await seedReadyVoice()
    expect(await codeOf(run())).toBeNull()

    guestbook.takeDown(EVENT, ENTRY, AT)

    expect(await codeOf(run())).toBe('guestbook.notFound')
  })
})
