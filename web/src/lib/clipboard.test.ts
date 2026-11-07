import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from './clipboard'

const setClipboard = (value: unknown): void => {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

describe('copyToClipboard', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('writes the text and answers true', async () => {
    const writeText = vi.fn(async () => undefined)
    setClipboard({ writeText })

    await expect(copyToClipboard('K7QM-2XTR')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('K7QM-2XTR')
  })

  it('answers false, without rejecting, when the browser refuses', async () => {
    setClipboard({
      writeText: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))),
    })

    await expect(copyToClipboard('x')).resolves.toBe(false)
  })

  it('answers false when there is no clipboard at all (an insecure origin)', async () => {
    setClipboard(undefined)

    await expect(copyToClipboard('x')).resolves.toBe(false)
  })

  it('answers false when the clipboard has no writeText', async () => {
    setClipboard({})

    await expect(copyToClipboard('x')).resolves.toBe(false)
  })
})
