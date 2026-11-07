import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { REEL_VARIANT } from '../../../application/ports/mediaStore'
import { type Db } from '../connection'
import { toPosix } from './paths'

/** Filesystem helpers shared by create, verify and restore: checksummed copy, the media walk. */

/** Left behind by an interrupted `fsMediaStore.put`; not addressable content. */
export const TEMPORARY_SUFFIX = '.tmp'

/** One place for the `unknown` a catch hands over, instead of four identical ternaries. */
export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * The first fifteen bytes of every SQLite file, checked before a connection is opened.
 *
 * `openDatabase` would find this out too — better-sqlite3 reads the header at the first
 * statement, so the pragmas raise `file is not a database` — but by then the handle
 * exists and nothing closes it, which on Windows leaves the file locked for the rest of
 * the process. Reading the header first keeps a typo in `--database` to one clear
 * sentence instead of a driver error and a held lock.
 */
export const looksLikeSqlite = async (path: string): Promise<boolean> => {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(15)
    const { bytesRead } = await handle.read(header, 0, 15, 0)
    return bytesRead === 15 && header.toString('latin1') === 'SQLite format 3'
  } finally {
    await handle.close()
  }
}

/**
 * Streams a file through sha256, optionally writing it somewhere else on the way.
 *
 * A `Transform` in the middle rather than a `data` listener: attaching a listener puts
 * the readable into flowing mode before the destination is piped, which drops the
 * first chunks of a large file on a fast disk. The bytes are read once whether or not
 * they are being copied, so hashing during the copy costs no extra I/O — which is what
 * makes checksumming every photo affordable on a four-thousand-photo album.
 */
export const streamThroughSha256 = async (
  from: string,
  to: string | null,
): Promise<{ bytes: number; sha256: string }> => {
  const hash = createHash('sha256')
  let bytes = 0

  if (to === null) {
    for await (const chunk of createReadStream(from)) {
      const buffer = chunk as Buffer
      hash.update(buffer)
      bytes += buffer.length
    }
    return { bytes, sha256: hash.digest('hex') }
  }

  const tap = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      hash.update(chunk)
      bytes += chunk.length
      callback(null, chunk)
    },
  })

  await mkdir(dirname(to), { recursive: true })
  await pipeline(createReadStream(from), tap, createWriteStream(to))

  return { bytes, sha256: hash.digest('hex') }
}

interface WalkedFile {
  readonly absolute: string
  readonly relative: string
}

/** Depth-first, sorted, files only. Anything else is reported rather than guessed at. */
export const walkFiles = async (
  root: string,
  skipped: string[],
  prefix = '',
): Promise<readonly WalkedFile[]> => {
  let entries
  try {
    entries = await readdir(join(root, prefix), { withFileTypes: true })
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return []
    throw error
  }

  const found: WalkedFile[] = []
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const relative = prefix === '' ? entry.name : join(prefix, entry.name)
    if (entry.isDirectory()) {
      /**
       * **A dot-directory at the top of `MEDIA_ROOT` is scratch, not content.**
       *
       * An event id is the only thing that belongs there, and none begins with a dot.
       * `.uploads` holds whatever multer is receiving right now and `.scratch` holds
       * whatever ffmpeg is writing right now — both emptied at the next boot, neither
       * addressable, and neither named by any row. Copied, they put the guest's
       * un-stripped original into the archive a **second** time (the staged source is
       * already there under its digest) and then counted as `unreferencedMediaFiles`,
       * which is the number the operator is told means a leak.
       */
      if (prefix === '' && entry.name.startsWith('.')) {
        // **Not `skipped`.** That channel carries things an operator should look at —
        // a file that is not a regular file, a name that cannot be written as an archive
        // path. These two directories are there on every healthy boot, so listing them
        // would put two permanent lines of noise in front of the real problems.
        continue
      }
      /**
       * **An event's highlight reel is not backed up** (spec 08): it is made from the photographs
       * and the host can ask for it again. Its row is saved with the database, and a row that
       * names a file the restored media root lacks is read as `stale`, never served.
       */
      if (prefix !== '' && !/[\\/]/.test(prefix) && entry.name === REEL_VARIANT) {
        continue
      }
      found.push(...(await walkFiles(root, skipped, relative)))
      continue
    }
    if (!entry.isFile()) {
      skipped.push(`${toPosix(relative)}: not a regular file`)
      continue
    }
    if (entry.name.endsWith(TEMPORARY_SUFFIX)) {
      // `fsMediaStore.put` writes `<target>.<uuid>.tmp` and renames. Copying one would
      // put a file in the archive that the store itself would never read back.
      skipped.push(`${toPosix(relative)}: staging file from an upload in flight`)
      continue
    }
    found.push({ absolute: join(root, relative), relative })
  }
  return found
}

/** SQLite's own verdict, as one word. `simple` asks for the scalar, not a row set. */
export const integrityCheck = (db: Db): string =>
  String(db.pragma('integrity_check', { simple: true }))
