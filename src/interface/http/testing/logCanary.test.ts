import { describe, expect, it } from 'vitest'
import { createPinoLogger } from '../../../infrastructure/logging/pinoLogger'
import { captureAllOutputWhile } from './captureOutput'
import { buildServerHarness } from './serverHarness'
import { CANARY, CANARY_VALUES, fireLogCanarySweep } from './logCanary'

const INSTANCE_BINDINGS = {
  service: 'eventslide',
  version: 'sweep-test',
  instance: 'sweep-instance',
}

describe('the log canary sweep', () => {
  it('finds none of the canaries anywhere in the log, across every mounted route', async () => {
    // A real logger and a real, *enabled* access log — the point of this test is what a
    // production box actually writes, not what a silenced test harness would.
    const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE_BINDINGS })
    const harness = buildServerHarness({
      logger,
      config: { accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE_BINDINGS } },
    })

    let requestCount = 0
    const output = await captureAllOutputWhile(async () => {
      const result = await fireLogCanarySweep(harness.app)
      requestCount = result.requestCount
    })

    // A sweep of zero routes would pass this suite vacuously. The real server mounts
    // several dozen; this just rules out "the walk found nothing".
    expect(requestCount).toBeGreaterThan(20)

    for (const value of CANARY_VALUES) {
      expect(output).not.toContain(value)
    }
  })

  it('actually wrote something, so "no canary found" is not "nothing was captured"', async () => {
    const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE_BINDINGS })
    const harness = buildServerHarness({
      logger,
      config: { accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE_BINDINGS } },
    })

    const output = await captureAllOutputWhile(async () => {
      await fireLogCanarySweep(harness.app)
    })

    expect(output.length).toBeGreaterThan(0)
    expect(output).toContain(INSTANCE_BINDINGS.instance)
  })

  it('still finds the canary clean with the access log disabled, which is the default test posture', async () => {
    // Belt and braces: the default harness (`accessLog: { enabled: false }`, silent
    // logger) is used by every other HTTP test in this repository, so it had better be
    // canary-clean too — trivially, since it writes nothing at all.
    const harness = buildServerHarness()

    const output = await captureAllOutputWhile(async () => {
      await fireLogCanarySweep(harness.app)
    })

    expect(output).toBe('')
  })
})

describe('CANARY', () => {
  it('is a distinctive value per field, so a match in the log can be attributed', () => {
    const values = Object.values(CANARY)
    expect(new Set(values).size).toBe(values.length)
  })
})
