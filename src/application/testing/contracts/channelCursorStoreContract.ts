import { describe, expect, it } from 'vitest'
import type { ChannelCursorStore } from '../../ports/channelCursorStore'

/** The shared `ChannelCursorStore` contract (spec 27): one cursor per channel, replaced as it moves. */
export const channelCursorStoreContract = (
  name: string,
  makeStore: () => Promise<{ store: ChannelCursorStore; dispose?: () => Promise<void> }>,
): void => {
  describe(`ChannelCursorStore contract: ${name}`, () => {
    it('has no cursor before the first message was handled', async () => {
      const { store, dispose } = await makeStore()

      expect(await store.get('telegram')).toBeNull()
      await dispose?.()
    })

    it('remembers the cursor and replaces it as the inbox moves', async () => {
      const { store, dispose } = await makeStore()

      await store.set('telegram', '100')
      await store.set('telegram', '101')

      expect(await store.get('telegram')).toBe('101')
      await dispose?.()
    })
  })
}
