import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApi } from '../api/client'
import { UPLOAD_STALL_MS, http } from '../http'
import { apiOutboxSender } from './apiSender'
import { drainOutbox } from './drainOutbox'
import { MemoryOutbox } from './memoryOutbox'
import { anEntry, t } from './testing/outboxStoreContract'

/**
 * A photo whose upload stops moving must let go of the outbox.
 *
 * Page, real transport, real sender and the behaving in-memory store; only the browser's
 * `XMLHttpRequest` is stood in for. What is pinned is the chain the guest depends on: the
 * transport gives up a stalled send, the sender turns that into "keep the photo", the drain
 * returns (so the hook's `running` guard is released in its `finally`) and the entry is free
 * for the next drain instead of being stuck behind its own claim.
 */

const SLUG = 'camille-et-sacha'

type Behaviour = 'stall' | 'accept'

class QuietXhr extends EventTarget {
  static behaviour: Behaviour = 'stall'
  readonly upload = new EventTarget()
  private sent = false

  open(): void {}
  setRequestHeader(): void {}
  withCredentials = false
  status = 0
  responseText = ''

  send(): void {
    this.sent = true
    if (QuietXhr.behaviour === 'accept') {
      this.status = 201
      this.responseText = JSON.stringify({
        results: [{ status: 'accepted', photoId: 'photo-1', duplicate: false }],
      })
      queueMicrotask(() => this.dispatchEvent(new Event('load')))
    }
  }

  abort(): void {
    if (this.sent) this.dispatchEvent(new Event('abort'))
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  QuietXhr.behaviour = 'stall'
  vi.stubGlobal('XMLHttpRequest', QuietXhr)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('draining over a transport that stalls', () => {
  it('returns with the photo kept, then sends it on the next drain', async () => {
    const store = new MemoryOutbox()
    await store.add(anEntry({ slug: SLUG }), t)
    const send = apiOutboxSender(createApi(http))
    let clock = t

    const first = drainOutbox({ store, slug: SLUG, send, now: () => clock })
    let returned = false
    void first.then(() => {
      returned = true
    })

    await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS - 1)
    expect(returned).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const report = await first
    expect(report.sent).toEqual([])
    expect(report.remaining).toBe(1)

    // The claim is gone: a later drain, on a network that works again, sends the photo.
    QuietXhr.behaviour = 'accept'
    clock += UPLOAD_STALL_MS + 5_000
    const second = drainOutbox({ store, slug: SLUG, send, now: () => clock })
    await vi.advanceTimersByTimeAsync(0)

    expect((await second).sent).toHaveLength(1)
    expect(await store.list(SLUG)).toHaveLength(0)
  })
})
