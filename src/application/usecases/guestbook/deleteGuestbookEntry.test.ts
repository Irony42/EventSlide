import { beforeEach, describe, expect, it } from 'vitest'
import { STAGED_SOURCE } from '../../../domain/photos/mediaVariant'
import { asEventId, asGuestId, asGuestbookEntryId } from '../../../domain/shared/ids'
import { aGuestbookEntry, aVoiceEntry, anEvent } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from '../../testing/fakeGuestbookVoiceRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeDeleteGuestbookEntry, type DeleteGuestbookEntry } from './deleteGuestbookEntry'

const EVENT = asEventId('event-1')
const LEA = asGuestId('guest-lea')
const M1 = asGuestbookEntryId('m1')

describe('deleteGuestbookEntry', () => {
  let events: FakeEventRepository
  let guestbook: FakeGuestbookRepository
  let media: InMemoryMediaStore
  let bus: RecordingEventBus
  let clock: FakeClock
  let remove: DeleteGuestbookEntry

  beforeEach(() => {
    events = new FakeEventRepository()
    guestbook = new FakeGuestbookRepository()
    media = new InMemoryMediaStore()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    events.seed(anEvent({ id: 'event-1' }))
    guestbook.seed(aGuestbookEntry({ id: 'm1', guestId: 'guest-lea', eventId: 'event-1' }))
    remove = makeDeleteGuestbookEntry({
      events,
      guestbook,
      voices: new FakeGuestbookVoiceRepository(guestbook),
      media,
      bus,
      clock,
    })
  })

  const run = (input: { guestId?: typeof LEA; entryId?: typeof M1; eventId?: typeof EVENT } = {}) =>
    remove({ eventId: EVENT, entryId: M1, guestId: LEA, ...input })

  const codeOf = async (promise: ReturnType<typeof run>): Promise<string | null> => {
    const result = await promise
    return result.ok ? null : result.error.code
  }

  it('lets the author take back a pending message, and tells the bus', async () => {
    const result = await run()

    expect(result.ok).toBe(true)
    expect(guestbook.all(EVENT)).toEqual([])
    expect(bus.published).toEqual([{ type: 'guestbook.changed', eventId: EVENT }])
  })

  it('answers another guest message as not found, and leaves it', async () => {
    expect(await codeOf(run({ guestId: asGuestId('guest-sam') }))).toBe('guestbook.notFound')
    expect(guestbook.all(EVENT)).toHaveLength(1)
    expect(bus.published).toEqual([])
  })

  it('answers another event message as not found', async () => {
    events.seed(anEvent({ id: 'event-2', slug: 'other', joinCode: 'OTHER1' }))

    expect(await codeOf(run({ eventId: asEventId('event-2') }))).toBe('guestbook.notFound')
  })

  it('answers an unknown id, and a message the operator took down, as not found', async () => {
    expect(await codeOf(run({ entryId: asGuestbookEntryId('nope') }))).toBe('guestbook.notFound')

    guestbook.takeDown(EVENT, M1, new Date(0))
    expect(await codeOf(run())).toBe('guestbook.notFound')
  })

  it('answers an unknown or taken-down event as not there', async () => {
    expect(await codeOf(run({ eventId: asEventId('nope') }))).toBe('event.notFound')

    await events.setTakenDown(EVENT, new Date(0))
    expect(await codeOf(run())).toBe('event.notFound')
  })

  it('refuses with the host veto when self-delete is switched off', async () => {
    events.seed(anEvent({ id: 'event-1', settings: { allowGuestSelfDelete: false } }))

    expect(await codeOf(run())).toBe('event.guestSelfDeleteDisabled')
    expect(guestbook.all(EVENT)).toHaveLength(1)
  })

  it('refuses once the grace window is over', async () => {
    clock.advance(901_000)

    expect(await codeOf(run())).toBe('guestbook.deleteForbidden')
  })

  it('refuses once the message is on the wall, as it does a published photograph', async () => {
    guestbook.seed(
      aGuestbookEntry({ id: 'm1', guestId: 'guest-lea', eventId: 'event-1', moderation: 'auto' }),
    )

    expect(await codeOf(run())).toBe('guestbook.deleteForbidden')
  })

  it('fails generically on a purge-held event, after the lookup so an unknown id stays a 404', async () => {
    await events.setPurgeHeld(EVENT, new Date(0))

    expect(await codeOf(run())).toBe('guestbook.deleteFailed')
    expect(await codeOf(run({ entryId: asGuestbookEntryId('nope') }))).toBe('guestbook.notFound')
    expect(guestbook.all(EVENT)).toHaveLength(1)
  })

  describe('a voice message (rule 1 bis of spec 25)', () => {
    const seedVoice = (state: 'ready' | 'failed', moderation: 'manual' | 'auto' = 'auto'): void => {
      guestbook.seed(
        aVoiceEntry({ id: 'm1', guestId: 'guest-lea', eventId: 'event-1', state, moderation }),
      )
    }

    it('lets its author take back one published on arrival, inside the grace window', async () => {
      seedVoice('ready')

      expect((await run()).ok).toBe(true)
      expect(guestbook.all(EVENT)).toEqual([])
    })

    it('refuses once the grace window is over, the window being the only guard', async () => {
      seedVoice('ready')
      clock.advance(901_000)

      expect(await codeOf(run())).toBe('guestbook.deleteForbidden')
      expect(guestbook.all(EVENT)).toHaveLength(1)
    })

    it('lets its author clean up a voice that failed, window and host veto included', async () => {
      events.seed(anEvent({ id: 'event-1', settings: { allowGuestSelfDelete: false } }))
      seedVoice('failed', 'manual')
      clock.advance(86_400_000)

      expect((await run()).ok).toBe(true)
    })

    it('still honours the host veto on a voice that did not fail', async () => {
      events.seed(anEvent({ id: 'event-1', settings: { allowGuestSelfDelete: false } }))
      seedVoice('ready')

      expect(await codeOf(run())).toBe('event.guestSelfDeleteDisabled')
    })
  })

  describe('a voice message’s bytes and the archive (spec 25, section 10)', () => {
    const seedReady = async (moderation: 'manual' | 'auto' = 'auto') => {
      const entry = aVoiceEntry({
        id: 'm1',
        guestId: 'guest-lea',
        eventId: 'event-1',
        state: 'ready',
        moderation,
      })
      guestbook.seed(entry)
      const hash = entry.voice?.audioHash
      if (hash === null || hash === undefined) throw new Error('fixture')
      await media.put(EVENT, hash, 'voice', new Uint8Array([1, 2, 3]))
      return hash
    }

    it('deletes the output bytes with the row, and tells the console on the signal the wall never hears', async () => {
      const hash = await seedReady()

      const result = await run()

      expect(result.ok).toBe(true)
      expect(await media.exists(EVENT, hash, 'voice')).toBe(false)
      expect(guestbook.all(EVENT)).toEqual([])
      expect(bus.published).toEqual([{ type: 'guestbook.voice', eventId: EVENT }])
    })

    it('deletes the source a recording still being processed holds', async () => {
      const entry = aVoiceEntry({
        id: 'm1',
        guestId: 'guest-lea',
        eventId: 'event-1',
        state: 'queued',
      })
      guestbook.seed(entry)
      const hash = entry.voice?.sourceHash
      if (hash === undefined) throw new Error('fixture')
      await media.put(EVENT, hash, STAGED_SOURCE, new Uint8Array([9]))

      await run()

      expect(await media.exists(EVENT, hash, STAGED_SOURCE)).toBe(false)
      expect(guestbook.all(EVENT)).toEqual([])
    })

    it('deletes the bytes while the row that names them is still there, never the other way round', async () => {
      await seedReady()
      const rowsWhenBytesWent: number[] = []
      const deleteBytes = media.delete.bind(media)
      media.delete = async (...args) => {
        rowsWhenBytesWent.push(guestbook.all(EVENT).length)
        return deleteBytes(...args)
      }

      await run()

      expect(rowsWhenBytesWent).toEqual([1])
    })

    it('keeps the row when the bytes cannot be deleted, so the guest can try again', async () => {
      await seedReady()
      media.failDeletes()

      await expect(run()).rejects.toThrow()

      expect(guestbook.all(EVENT)).toHaveLength(1)
    })

    it('deletes no byte of a recording that failed: its digest may be a fresh attempt’s', async () => {
      const failed = aVoiceEntry({
        id: 'm1',
        guestId: 'guest-lea',
        eventId: 'event-1',
        state: 'failed',
      })
      guestbook.seed(failed)
      const digest = failed.voice?.sourceHash
      if (digest === undefined) throw new Error('fixture')
      await media.put(EVENT, digest, STAGED_SOURCE, new Uint8Array([7]))

      const result = await run()

      expect(result.ok).toBe(true)
      expect(await media.exists(EVENT, digest, STAGED_SOURCE)).toBe(true)
      expect(guestbook.all(EVENT)).toEqual([])
    })

    it('touches no byte on a purge-held event, and fails generically', async () => {
      const hash = await seedReady()
      await events.setPurgeHeld(EVENT, new Date(0))

      expect(await codeOf(run())).toBe('guestbook.deleteFailed')
      expect(await media.exists(EVENT, hash, 'voice')).toBe(true)
      expect(guestbook.all(EVENT)).toHaveLength(1)
    })

    it('touches no byte when the verdict is a refusal', async () => {
      const hash = await seedReady()
      clock.advance(901_000)

      expect(await codeOf(run())).toBe('guestbook.deleteForbidden')
      expect(await media.exists(EVENT, hash, 'voice')).toBe(true)
    })

    it('answers another guest’s recording as not found, and keeps its bytes', async () => {
      const hash = await seedReady()

      expect(await codeOf(run({ guestId: asGuestId('guest-sam') }))).toBe('guestbook.notFound')
      expect(await media.exists(EVENT, hash, 'voice')).toBe(true)
    })

    it('does not remove a written message through the recording path: its signal is the wall’s', async () => {
      await run()

      expect(bus.published).toEqual([{ type: 'guestbook.changed', eventId: EVENT }])
    })
  })
})
