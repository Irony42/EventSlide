import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { captureAllOutputWhile, captureDescriptorOutputWhile } from './captureOutput'

const MARK = 'CAPTURE-MARK-7d2e'

describe('captureDescriptorOutputWhile', () => {
  it('keeps what is written to file descriptor 1, synchronously or not', async () => {
    const output = await captureDescriptorOutputWhile(async () => {
      fs.writeSync(1, `${MARK}-sync\n`)
      await new Promise<void>((resolve) => fs.write(1, `${MARK}-async\n`, () => resolve()))
    })

    expect(output).toContain(`${MARK}-sync`)
    expect(output).toContain(`${MARK}-async`)
  })

  it('does not keep what goes to another descriptor, the console or process.stdout', async () => {
    const output = await captureDescriptorOutputWhile(() => {
      fs.writeSync(2, `${MARK}-stderr\n`)
      console.log(`${MARK}-console`)
      process.stdout.write(`${MARK}-stdout\n`)
    })

    expect(output).not.toContain(MARK)
  })

  it('waits one tick after the run, for a logger that batches its write', async () => {
    const output = await captureDescriptorOutputWhile(() => {
      setImmediate(() => fs.writeSync(1, `${MARK}-late\n`))
    })

    expect(output).toContain(`${MARK}-late`)
  })

  it('gives the real functions back, also when the run throws', async () => {
    const realWrite = fs.writeSync

    await expect(
      captureDescriptorOutputWhile(() => {
        throw new Error('the run failed')
      }),
    ).rejects.toThrow('the run failed')

    expect(fs.writeSync).toBe(realWrite)
  })
})

describe('captureAllOutputWhile', () => {
  it('keeps every channel a logger could use, the console methods included', async () => {
    const output = await captureAllOutputWhile(() => {
      fs.writeSync(1, `${MARK}-fd\n`)
      process.stdout.write(`${MARK}-stdout\n`)
      console.log(`${MARK}-log`)
      console.info(`${MARK}-info`)
      console.warn(`${MARK}-warn`)
      console.error(`${MARK}-error`)
      console.debug(`${MARK}-debug`)
    })

    for (const channel of ['fd', 'stdout', 'log', 'info', 'warn', 'error', 'debug']) {
      expect(output, channel).toContain(`${MARK}-${channel}`)
    }
  })

  it('formats a console argument as the console would, not as [object Object]', async () => {
    const output = await captureAllOutputWhile(() => console.log({ token: MARK }))

    expect(output).toContain(MARK)
  })

  it('gives every function back, also when the run throws', async () => {
    const { log } = console
    const { write } = process.stdout
    const { writeSync } = fs

    await expect(
      captureAllOutputWhile(() => {
        throw new Error('the run failed')
      }),
    ).rejects.toThrow('the run failed')

    expect(console.log).toBe(log)
    expect(process.stdout.write).toBe(write)
    expect(fs.writeSync).toBe(writeSync)
  })
})
