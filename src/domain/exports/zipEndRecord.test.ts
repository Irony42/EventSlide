import { describe, expect, it } from 'vitest'
import { ZIP_TAIL_BYTES, readZipEnd } from './zipEndRecord'

const eocd = (entries: number, options: { comment?: number; disk?: number } = {}): Uint8Array => {
  const record = new Uint8Array(22)
  const view = new DataView(record.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, options.disk ?? entries, true)
  view.setUint16(10, entries, true)
  view.setUint16(20, options.comment ?? 0, true)
  return record
}

const zip64 = (entries: bigint, locatorSignature = 0x07064b50, recordSignature = 0x06064b50) => {
  const record = new Uint8Array(56)
  new DataView(record.buffer).setUint32(0, recordSignature, true)
  new DataView(record.buffer).setBigUint64(32, entries, true)
  const locator = new Uint8Array(20)
  new DataView(locator.buffer).setUint32(0, locatorSignature, true)
  return [record, locator]
}

const join = (...parts: Uint8Array[]): Uint8Array => {
  const whole = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.byteLength
  }
  return whole
}

describe('readZipEnd (spec 22, check 3)', () => {
  it('reads the entry count of a classic end record', () => {
    expect(readZipEnd(eocd(7))).toEqual({ entries: 7 })
  })

  it('reads it from the end of a longer tail, ignoring what comes before', () => {
    expect(readZipEnd(join(new Uint8Array([1, 2, 3, 4, 5]), eocd(2)))).toEqual({ entries: 2 })
  })

  it('reads an empty archive', () => {
    expect(readZipEnd(eocd(0))).toEqual({ entries: 0 })
  })

  it('refuses a file cut short: no record where one must be', () => {
    expect(readZipEnd(new Uint8Array(10))).toBeNull()
    expect(readZipEnd(new Uint8Array(40))).toBeNull()
  })

  it('refuses a record that is not at the very end (bytes were added after it)', () => {
    expect(readZipEnd(join(eocd(3), new Uint8Array([0])))).toBeNull()
  })

  it('refuses a record that announces a comment, since the writer adds none', () => {
    expect(readZipEnd(eocd(3, { comment: 4 }))).toBeNull()
  })

  it('refuses a record whose two counts disagree', () => {
    expect(readZipEnd(eocd(3, { disk: 2 }))).toBeNull()
  })

  it('reads the count from the ZIP64 record when it does not fit in 16 bits', () => {
    const [record, locator] = zip64(100_000n)

    expect(readZipEnd(join(record, locator, eocd(0xffff)))).toEqual({ entries: 100_000 })
  })

  it('refuses a ZIP64 end whose locator or record is wrong or missing', () => {
    const [record, locator] = zip64(100_000n)
    const [badRecord] = zip64(5n, 0x07064b50, 0x12345678)
    const [, badLocator] = zip64(5n, 0x12345678)

    expect(readZipEnd(eocd(0xffff))).toBeNull()
    expect(readZipEnd(join(record, badLocator, eocd(0xffff)))).toBeNull()
    expect(readZipEnd(join(badRecord as Uint8Array, locator, eocd(0xffff)))).toBeNull()
  })

  it('refuses a ZIP64 count no number can hold', () => {
    const [record, locator] = zip64(2n ** 60n)

    expect(readZipEnd(join(record, locator, eocd(0xffff)))).toBeNull()
  })

  it('needs no more than the three records of the tail', () => {
    expect(ZIP_TAIL_BYTES).toBe(98)
  })
})
