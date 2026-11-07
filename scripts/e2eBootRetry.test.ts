import { describe, expect, it } from 'vitest'
import { BOOT_ATTEMPTS, retryOnLostPort } from '../tests/e2e/fixtures/startTestApp'

const PORT_TAKEN = new Error(
  'the server exited with code 1 before becoming ready\n\nEventSlide failed to start: Error: listen EADDRINUSE: address already in use :::37817',
)

/** A boot that fails with each of `outcomes` in turn, then succeeds. */
const bootFailing = (
  outcomes: readonly Error[],
): { boot: () => Promise<string>; calls: () => number } => {
  let calls = 0
  return {
    boot: () => {
      const failure = outcomes[calls]
      calls += 1
      return failure === undefined ? Promise.resolve('up') : Promise.reject(failure)
    },
    calls: () => calls,
  }
}

describe('retryOnLostPort', () => {
  it('boots again on a fresh port when the first lost the race for it', async () => {
    const subject = bootFailing([PORT_TAKEN])

    await expect(retryOnLostPort(subject.boot)).resolves.toBe('up')
    expect(subject.calls()).toBe(2)
  })

  it('gives up with the boot error after the bounded number of attempts', async () => {
    const subject = bootFailing(Array.from({ length: BOOT_ATTEMPTS + 3 }, () => PORT_TAKEN))

    await expect(retryOnLostPort(subject.boot)).rejects.toBe(PORT_TAKEN)
    expect(subject.calls()).toBe(BOOT_ATTEMPTS)
  })

  it('does not retry a boot that failed for any other reason', async () => {
    const other = new Error(
      'the server exited with code 1 before becoming ready\n\nmigration failed',
    )
    const subject = bootFailing([other])

    await expect(retryOnLostPort(subject.boot)).rejects.toBe(other)
    expect(subject.calls()).toBe(1)
  })
})
