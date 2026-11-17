import { inflateRawSync } from 'node:zlib'

/**
 * A ZIP read the way a stranger's unzip tool reads it: from the end record, through the central
 * directory, to each entry's bytes. Nothing of the server's own code is used, so a journey that
 * downloads an archive checks the file the browser really saved and not what the writer meant.
 *
 * Only what the album archives use: stored or deflated entries, no ZIP64, no encryption.
 */

export interface ZipEntry {
  readonly name: string
  readonly data: Buffer
}

const END_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

export const readZip = (bytes: Buffer): readonly ZipEntry[] => {
  // The end record is the last 22 bytes plus a comment of up to 65 535: look backwards for it.
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at -= 1) {
    if (bytes.readUInt32LE(at) === END_SIGNATURE) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error('no end of central directory record: not a whole ZIP')

  const count = bytes.readUInt16LE(end + 10)
  let cursor = bytes.readUInt32LE(end + 16)
  const entries: ZipEntry[] = []

  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error('bad central header')
    const method = bytes.readUInt16LE(cursor + 10)
    const compressed = bytes.readUInt32LE(cursor + 20)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const local = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')

    if (bytes.readUInt32LE(local) !== LOCAL_SIGNATURE) throw new Error(`bad local header: ${name}`)
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
    const raw = bytes.subarray(start, start + compressed)
    if (method !== 0 && method !== 8) throw new Error(`unsupported method ${method}: ${name}`)
    entries.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) })

    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}
