import { act } from '@testing-library/react'

/**
 * Lets every promise already in flight run to its end, with React's updates applied.
 *
 * It is how a test asserts that something did *not* happen: settle first, then check
 * the absence. An async `act` returns only after the microtask queue has drained and
 * React has flushed, so it waits for the work and not for a duration: unlike a real
 * `setTimeout` sleep it neither passes because the machine was slow nor costs wall time.
 */
export const flushPromises = (): Promise<void> => act(async () => {})
