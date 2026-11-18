import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http'
import { fakeApi } from '../../testing/renderWithProviders'
import { apiVoiceSender } from './apiVoiceSender'
import { anEntry, t } from './testing/outboxStoreContract'
import type { OutboxEntry } from './outbox'

/**
 * The voice queue's sender: one recording to `POST …/guestbook/voice`, and the three-state reading
 * of the answer (`voicePolicy.test.ts` has the table; this is the transport around it).
 */

const aRecording = (): OutboxEntry => ({
  ...anEntry({ fileName: 'message-vocal.webm', fileType: 'audio/webm', caption: 'Pour vous' }),
  id: 'entry-1',
  enqueuedAt: t,
  attempts: 0,
  lastAttemptAt: null,
  claimedAt: null,
})

describe('apiVoiceSender', () => {
  it('sends the recording through the voice route and never through the photo one', async () => {
    // The photo route refuses a recording with a terminal code, and the photo queue would then
    // destroy the one thing a guest cannot make again.
    const api = fakeApi()

    const outcome = await apiVoiceSender(api)(aRecording())

    expect(outcome).toEqual({ kind: 'sent', photoId: 'voice-1', duplicate: false })
    expect(api.uploadPhotos).not.toHaveBeenCalled()
    const call = vi.mocked(api.leaveVoiceMessage).mock.calls[0]
    expect(call?.[0]).toBe('camille-et-sacha')
    expect(call?.[1].file.name).toBe('message-vocal.webm')
    expect(call?.[1].file.type).toBe('audio/webm')
    expect(call?.[1].caption).toBe('Pour vous')
  })

  it('reports a duplicate as sent: the same recording is already there', async () => {
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => ({
        entry: {
          id: 'voice-9',
          text: null,
          status: 'pending' as const,
          createdAt: '2026-06-20T21:04:11.031Z',
          duplicate: true,
          voice: { state: 'queued' as const, durationMs: null, caption: null },
        },
      })),
    })

    expect(await apiVoiceSender(api)(aRecording())).toEqual({
      kind: 'sent',
      photoId: 'voice-9',
      duplicate: true,
    })
  })

  it('blocks, keeping the recording, when the host has switched the voices off', async () => {
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => {
        throw new ApiError(409, 'guestbook.voiceDisabled')
      }),
    })

    expect(await apiVoiceSender(api)(aRecording())).toEqual({
      kind: 'blocked',
      code: 'guestbook.voiceDisabled',
    })
  })

  it('drops the recording only for a refusal of its content', async () => {
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => {
        throw new ApiError(400, 'voice.corrupt')
      }),
    })

    expect(await apiVoiceSender(api)(aRecording())).toEqual({
      kind: 'rejected',
      code: 'voice.corrupt',
    })
  })

  it('defers when the transport itself threw', async () => {
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })

    expect(await apiVoiceSender(api)(aRecording())).toEqual({ kind: 'deferred' })
  })
})
