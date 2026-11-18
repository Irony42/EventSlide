import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveRecordingToPhone } from './saveRecording'
import { anEntry, t } from '../../lib/offline/testing/outboxStoreContract'
import type { OutboxEntry } from '../../lib/offline/outbox'

/** "Enregistrer sur mon téléphone": a recording the phone could not send is handed back as a file. */

const aRecording = (): OutboxEntry => ({
  ...anEntry({ fileName: 'message-vocal.webm', fileType: 'audio/webm' }),
  id: 'entry-1',
  enqueuedAt: t,
  attempts: 0,
  lastAttemptAt: null,
  claimedAt: null,
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('saveRecordingToPhone', () => {
  it('offers the bytes the queue kept as a download under the name of the recording', () => {
    URL.createObjectURL = vi.fn(() => 'blob:the-recording')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const anchors: HTMLAnchorElement[] = []
    const append = vi.spyOn(document.body, 'append').mockImplementation((...nodes) => {
      for (const node of nodes) if (node instanceof HTMLAnchorElement) anchors.push(node)
    })

    expect(saveRecordingToPhone(aRecording())).toBe(true)

    expect(click).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalled()
    expect(anchors[0]?.download).toBe('message-vocal.webm')
    expect(anchors[0]?.href).toBe('blob:the-recording')
  })

  it('releases the object URL once the click has been handled', async () => {
    vi.useFakeTimers()
    URL.createObjectURL = vi.fn(() => 'blob:the-recording')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    saveRecordingToPhone(aRecording())
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:the-recording')
    vi.useRealTimers()
  })

  it('says it offered nothing, and does not throw, where the browser cannot make a file', () => {
    expect(saveRecordingToPhone(aRecording())).toBe(false)
  })

  it('does not throw when the browser refuses the download', () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error('refused')
    })

    expect(saveRecordingToPhone(aRecording())).toBe(false)
  })
})
