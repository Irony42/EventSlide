import { describe, expect, it } from 'vitest'
import { PUSH_ONLY_CACHE, readPushOnly, writePushOnly, type ModeStorage } from './pushOnlyMode'
import { CACHE_PREFIX } from '../pwa/appShell'

/**
 * The push-only mode of the worker, kept in a Cache Storage so that a restarted worker still knows it
 * (spec 30, lot 4): turned on and off, read back by a new reader of the same storage, never lost by
 * sweeping the shell caches, and never a reason for the worker to break when the storage fails.
 */

const aStorage = (): ModeStorage & { caches: Map<string, Map<string, Response>> } => {
  const caches = new Map<string, Map<string, Response>>()
  return {
    caches,
    open: async (name) => {
      const entries = caches.get(name) ?? new Map<string, Response>()
      caches.set(name, entries)
      return {
        match: async (request) => entries.get(request),
        put: async (request, response) => void entries.set(request, response),
        delete: async (request) => entries.delete(request),
      }
    },
  }
}

describe('the push-only mode', () => {
  it('is off in a fresh storage, on once written, and off again once cleared', async () => {
    const storage = aStorage()

    expect(await readPushOnly(storage)).toBe(false)
    await writePushOnly(storage, true)
    expect(await readPushOnly(storage)).toBe(true)
    await writePushOnly(storage, false)
    expect(await readPushOnly(storage)).toBe(false)
  })

  it('is what a worker that was stopped and started again finds in the same storage', async () => {
    const storage = aStorage()
    await writePushOnly(storage, true)

    // A new worker is a new reader of the same storage, with nothing else in common.
    expect(await readPushOnly({ open: storage.open })).toBe(true)
  })

  it('lives in a cache that sweeping the shell caches does not match', () => {
    expect(PUSH_ONLY_CACHE.startsWith(CACHE_PREFIX)).toBe(false)
  })

  it('does not fail, and is not push-only, when the storage fails', async () => {
    const broken: ModeStorage = {
      open: async () => {
        throw new Error('quota')
      },
    }

    expect(await readPushOnly(broken)).toBe(false)
    await expect(writePushOnly(broken, true)).resolves.toBeUndefined()
  })
})
