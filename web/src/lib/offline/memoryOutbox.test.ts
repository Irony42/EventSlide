import { MemoryOutbox } from './memoryOutbox'
import { outboxStoreContract } from './outboxStoreContract'

/**
 * The fallback store, held to the same contract as the real one.
 *
 * It is not only a test double: a phone whose browser refuses to open a database gets
 * this, and a queue that works for the length of the tab is most of the value. See
 * `outboxStoreContract.ts`.
 */
outboxStoreContract('memory', async () => new MemoryOutbox())
