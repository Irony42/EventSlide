import { readZipEnd, ZIP_TAIL_BYTES } from '../../../domain/exports/zipEndRecord'
import { DomainError } from '../../../domain/shared/errors'
import type { ArchiveEntry } from '../../ports/archiveWriter'
import type { ByteRange } from '../../ports/mediaStore'
import type { StreamHasher } from '../../ports/streamHasher'

/**
 * Two of the four checks of a verified album archive (spec 22, section 6), written once because
 * two callers make the same archive: the box's own worker (`buildNextAlbumExport`, a file under
 * `.exports` for the host) and the operator's command (`exportAlbumToFolder`, a copy outside the
 * box). A check copied into the second would be a check that drifts.
 */

/** Rows per read of the album; the disk is read again every page (`albumEntries` pages the same). */
export const ARCHIVE_PAGE_SIZE = 200

/** A finished archive the caller can read back, wherever it was written. */
export interface ArchiveReader {
  /** The size, or `null` when there is no finished file. */
  stat(): Promise<{ readonly size: number } | null>
  /** The bytes (or a range of them), or `null` when there is none. */
  openRead(range?: ByteRange): Promise<AsyncIterable<Uint8Array> | null>
}

const collect = async (bytes: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const parts: Uint8Array[] = []
  let length = 0
  for await (const chunk of bytes) {
    parts.push(chunk)
    length += chunk.byteLength
  }
  const whole = new Uint8Array(length)
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.byteLength
  }
  return whole
}

/**
 * **Check 4: the finished file read again from the disk**, not from the stream. Answers `true`
 * when its size is what was written, its SHA-256 is the one computed while writing, and its
 * end-of-central-directory record announces `entries + 1` entries (the manifest is the one the
 * count leaves out).
 */
export const verifiedOnDisk = async (
  reader: ArchiveReader,
  streamHasher: StreamHasher,
  written: { readonly bytes: number; readonly sha256: string; readonly entries: number },
): Promise<boolean> => {
  const stored = await reader.stat()
  if (stored === null || stored.size !== written.bytes) return false

  const hash = streamHasher.start()
  const whole = await reader.openRead()
  if (whole === null) return false
  for await (const chunk of whole) hash.update(chunk)
  if (hash.digestHex() !== written.sha256) return false

  const start = Math.max(0, written.bytes - ZIP_TAIL_BYTES)
  const tail = await reader.openRead({ start, end: written.bytes - 1 })
  if (tail === null) return false
  const end = readZipEnd(await collect(tail))
  return end !== null && end.entries === written.entries + 1
}

/**
 * **Check 1, the part that runs while writing**: the room is read again every page, and the
 * shutdown is honoured between two entries. A full disk (or one that cannot be read) abandons the
 * write with `export.noRoom`, rather than let a wedding's uploads be refused for an archive's sake.
 */
export async function* guardedEntries(
  entries: AsyncIterable<ArchiveEntry>,
  guard: {
    readonly freeDiskBytes: () => Promise<number | null>
    readonly minFreeDiskBytes: number
    readonly signal?: AbortSignal | undefined
  },
): AsyncIterable<ArchiveEntry> {
  let count = 0
  for await (const entry of entries) {
    if (guard.signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
    count += 1
    if (count % ARCHIVE_PAGE_SIZE === 0) {
      const free = await guard.freeDiskBytes()
      if (free === null || free < guard.minFreeDiskBytes) {
        throw DomainError.conflict('export.noRoom')
      }
    }
    yield entry
  }
}
