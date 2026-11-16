/**
 * Reads the entry count out of the end of a ZIP, by hand (spec 22, section 6, check 3): **no new
 * dependency**, 22 bytes and a signature. It catches what a disk that filled up mid-write does
 * without raising an error: a file cut short has no end-of-central-directory record where one must
 * be, and a ZIP rewritten by something else announces another count.
 *
 * `tail` is the **last bytes of the file** (the caller reads at most {@link ZIP_TAIL_BYTES}). The
 * record is expected at the very end: the writer adds no archive comment, and a file that has bytes
 * after the record is not the file that was written. When the count does not fit in 16 bits the
 * writer uses ZIP64, whose record and locator sit just before the classic one; both are read.
 *
 * Returns `null` for anything that is not a well-formed end of archive: too short, a wrong
 * signature, a disagreeing locator.
 */

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const EOCD_LENGTH = 22
const ZIP64_LOCATOR_LENGTH = 20
const ZIP64_EOCD_LENGTH = 56

/** How much of the end of the file to hand over: the three records, every one of them. */
export const ZIP_TAIL_BYTES = EOCD_LENGTH + ZIP64_LOCATOR_LENGTH + ZIP64_EOCD_LENGTH

export interface ZipEnd {
  /** Entries in the central directory. */
  readonly entries: number
}

export const readZipEnd = (tail: Uint8Array): ZipEnd | null => {
  if (tail.byteLength < EOCD_LENGTH) return null
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  const eocdAt = tail.byteLength - EOCD_LENGTH
  if (view.getUint32(eocdAt, true) !== EOCD_SIGNATURE) return null
  // No comment: a non-zero length means bytes follow that nobody wrote.
  if (view.getUint16(eocdAt + 20, true) !== 0) return null

  const onThisDisk = view.getUint16(eocdAt + 8, true)
  const total = view.getUint16(eocdAt + 10, true)
  if (total !== 0xffff) return onThisDisk === total ? { entries: total } : null

  // ZIP64: the locator is right before the classic record, the ZIP64 record right before that.
  const locatorAt = eocdAt - ZIP64_LOCATOR_LENGTH
  const recordAt = locatorAt - ZIP64_EOCD_LENGTH
  if (recordAt < 0) return null
  if (view.getUint32(locatorAt, true) !== ZIP64_LOCATOR_SIGNATURE) return null
  if (view.getUint32(recordAt, true) !== ZIP64_EOCD_SIGNATURE) return null
  const count = view.getBigUint64(recordAt + 32, true)
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return { entries: Number(count) }
}
