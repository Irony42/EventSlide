import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { MEDIA_VARIANTS } from '../../application/ports/mediaStore'
import { closeDatabase, openDatabase, type Db } from './connection'
import { checksumOf, migrate, MigrationError, type Migration } from './migrator'

/**
 * Backup and restore of the two halves of an EventSlide installation: the SQLite
 * database and the media root.
 *
 * It lives under `db/` because the half that is easy to get catastrophically wrong is
 * the database one. `docs/SECURITY.md` §11 has always said why: **copying a live WAL
 * database yields a corrupt backup**, because the bytes in `.sqlite` are only half the
 * story while `-wal` holds the rest. `VACUUM INTO` is the answer — SQLite writes a
 * consistent snapshot of an open database into a new file, taking a read lock rather
 * than asking the operator to stop the server first. A host who takes a backup at
 * midnight, mid-event, must not be handed a file that opens fine and is missing the
 * last hour.
 *
 * ## The archive is a directory
 *
 * Not a tar, and not a zip — even though `archiver` is already a dependency for the
 * album export. Four reasons, in order of weight:
 *
 * 1. **`VACUUM INTO` writes to a path.** It cannot write into a stream, so the
 *    snapshot lands on disk regardless. A zip would mean writing the database once and
 *    then reading it back to compress it.
 * 2. **The payload is already compressed.** A wedding media root is JPEGs; the album
 *    export sets `store: true` for exactly this reason. Compression would buy nothing
 *    and cost a full second pass over several gigabytes.
 * 3. **A directory can be copied incrementally and repaired in place.** `rsync` to a
 *    second disk resumes; a half-transferred 40 GB zip is worth nothing. An operator
 *    can also `ls` it, which matters at 2am.
 * 4. **Restore can be partial.** One missing photo is one missing file, not a reason
 *    to unpack 12 000 entries to find out.
 *
 * The layout:
 *
 * ```
 * <archive>/
 *   manifest.json                     counts, checksums, the migration ledger
 *   database.sqlite                   the VACUUM INTO snapshot
 *   media/<eventId>/<variant>/<ab>/<contentHash>.jpg
 * ```
 *
 * ## Which half is captured first, and what the skew means
 *
 * The two halves cannot be captured at the same instant, so one of them is older. The
 * **database is captured first**, and that ordering is the whole consistency story.
 *
 * | Order | A photo uploaded during the backup | A photo deleted during the backup |
 * | --- | --- | --- |
 * | database first, media second | no row, bytes present: **dead weight** | row present, bytes gone: reported as missing |
 * | media first, database second | **row with no bytes: a broken album** | row gone, bytes present: dead weight |
 *
 * A photo arriving mid-backup is the normal case at a live event — that is what the
 * product is for — and under database-first it is simply not in this backup, which is
 * the honest and recoverable outcome: the archive describes the installation as it was
 * at the moment the snapshot was taken. Under media-first the same upload produces a
 * row pointing at bytes that were never copied, and nothing notices until the album is
 * restored and a guest's photo renders as a broken tile.
 *
 * Deletion is the one case where database-first is the worse direction, and it is
 * bounded rather than silent: every photo row in the snapshot is checked against the
 * media that was copied, and any whose bytes were not there is listed by id in
 * `manifest.missingMedia`. A photo deleted during the window was on its way out
 * anyway; a photo missing for any *other* reason is a pre-existing inconsistency the
 * operator now knows about, which is more than they had before.
 *
 * Files copied that no row names are counted in `unreferencedMediaFiles`. That number
 * being non-zero is expected during a busy event and is not an error.
 */

/** Bumped when the layout or the manifest shape changes in a way a reader must notice. */
export const ARCHIVE_FORMAT = 'eventslide-backup/1'

export const MANIFEST_FILE = 'manifest.json'
export const DATABASE_FILE = 'database.sqlite'
export const MEDIA_DIR = 'media'

/** Left behind by an interrupted `fsMediaStore.put`; not addressable content. */
const TEMPORARY_SUFFIX = '.tmp'

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

/**
 * True of a C0 control character anywhere in the string.
 *
 * `\0` is the one that matters: Node throws `must be a string without null bytes` from
 * inside `fs`, so without this a hostile manifest surfaces as a stack trace rather than
 * as one sentence naming the manifest. The rest of the range goes with it because a
 * newline in a path makes every line of output below it a lie.
 *
 * A loop rather than a regex: matching that range needs a `\uXXXX` escape in this file,
 * and an escape for a control character has a way of arriving as the control character
 * itself. A comparison on the code unit needs nothing written down.
 */
const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) return true
  }
  return false
}

/**
 * Is this a path that could have come out of `toPosix(walkFiles(...))`?
 *
 * `entry.path` is the only string in an archive that becomes a **location** on the
 * restoring machine, and an archive is precisely the thing that travels — USB stick,
 * NAS, object storage, a handover between host and client. `restore` exists to read a
 * file that came from somewhere else, so the manifest is untrusted input in the sense
 * of rule 3 in `CLAUDE.md`, and the parse is where that gets settled.
 *
 * The rule **rejects rather than normalises**, deliberately. Normalising answers the
 * wrong question: the value of a backup is that it is exactly what was captured, and a
 * path that needed normalising was not written by this tool. What is refused, and why
 * each one is a location and not a filename:
 *
 * - `..` — the traversal itself. `.` and the empty segment come with it: they are what
 *   `/etc/x`, `a//b` and a trailing `/` leave behind, and `path.join` folds them away
 *   silently, so accepting them would mean accepting a path whose meaning changes
 *   between the manifest and the disk.
 * - `\` — the separator on Windows and the prefix of a UNC share. `a\..\..\x` is a
 *   traversal there and an odd but legal filename on Linux; neither is something
 *   `toPosix` produces.
 * - `:` — a drive (`C:/x`) and, worse, a drive-relative path (`C:x`), which resolves
 *   against a per-drive working directory rather than the root; also the NTFS alternate
 *   data stream separator, which hides bytes behind a legitimate-looking name.
 * - control characters — see `hasControlCharacter`.
 *
 * This is the parse-side gate, which is what makes one change protect both `verify` and
 * `restore`: every reader goes through `readManifest`. `resolveInside` is the
 * write-side gate.
 */
const isContainedPath = (value: string): boolean => {
  if (hasControlCharacter(value)) return false
  if (value.includes('\\') || value.includes(':')) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

const CONTAINED_PATH_MESSAGE =
  'must stay inside the archive: a relative path with "/" separators, no "." or ".." or ' +
  'empty segment, no drive letter, no backslash, no control character'

/** A path in a manifest that this build will turn into a location on disk. */
const containedPath = z.string().min(1).refine(isContainedPath, {
  message: CONTAINED_PATH_MESSAGE,
})

/**
 * The write-side half of the containment rule, and deliberately redundant.
 *
 * `entrySchema` has already refused anything that could get here, so in the current
 * call graph this never throws — that is the point of having it. The two gates fail for
 * different reasons: the schema is a statement about a manifest, this is a statement
 * about a filesystem, and a future caller of `restoreBackup` is not obliged to have
 * parsed anything. The cost of being wrong once is an arbitrary file write with the
 * privileges of whoever runs the restore, which is a cheap thing to pay twice for.
 *
 * `startsWith(base + sep)` rather than `startsWith(base)`: without the separator,
 * `<root>-old/x` reads as inside `<root>`.
 */
export const resolveInside = (root: string, relative: string): string => {
  const base = resolve(root)
  const candidate = resolve(base, relative)
  if (!candidate.startsWith(base + sep)) {
    throw new BackupError(
      `Refusing to touch ${candidate}: it must stay inside ${base}. The manifest names ` +
        `a path that leaves it.`,
    )
  }
  return candidate
}

const entrySchema = z.object({
  /** Relative to `<archive>/media`, always with `/` separators — and enforced, see above. */
  path: containedPath,
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})

const manifestSchema = z.object({
  format: z.string(),
  createdAt: z.string(),
  appVersion: z.string(),
  source: z.object({ databasePath: z.string(), mediaRoot: z.string() }),
  database: z.object({
    // The same rule as a media entry, for the same reason: this is joined onto the
    // archive root to find the snapshot. It is always `database.sqlite` in an archive
    // this build wrote, but nothing about reading one guarantees that.
    file: containedPath,
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    integrityCheck: z.string(),
  }),
  /** The `schema_migrations` ledger as it stood in the snapshot. */
  migrations: z.array(z.object({ id: z.number().int(), name: z.string(), checksum: z.string() })),
  counts: z.object({
    users: z.number().int().nonnegative(),
    events: z.number().int().nonnegative(),
    guests: z.number().int().nonnegative(),
    photos: z.number().int().nonnegative(),
    reactions: z.number().int().nonnegative(),
    mediaFiles: z.number().int().nonnegative(),
  }),
  media: z.object({
    bytes: z.number().int().nonnegative(),
    entries: z.array(entrySchema),
    /** sha256 over the canonical rendering of `entries`. Catches a truncated list. */
    entriesDigest: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  /** Photo rows whose bytes were not on disk when the media half was copied. */
  missingMedia: z.array(
    z.object({
      photoId: z.string(),
      eventId: z.string(),
      contentHash: z.string(),
      variant: z.string(),
    }),
  ),
  /** Files copied that no photo row names. The recoverable direction of skew. */
  unreferencedMediaFiles: z.number().int().nonnegative(),
  /** Anything skipped during the walk, with the reason. Normally empty. */
  skipped: z.array(z.string()),
})

export type ManifestEntry = z.infer<typeof entrySchema>
export type BackupManifest = z.infer<typeof manifestSchema>

// --------------------------------------------------------------------- helpers --

/** Manifest paths are `/`-separated so an archive taken on Windows restores on Linux. */
const toPosix = (path: string): string => path.split(sep).join('/')

const fromPosix = (path: string): string => path.split('/').join(sep)

/** One place for the `unknown` a catch hands over, instead of four identical ternaries. */
const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const exists = async (path: string): Promise<boolean> => {
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
const looksLikeSqlite = async (path: string): Promise<boolean> => {
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
const streamThroughSha256 = async (
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

/**
 * A fingerprint of the entry list itself.
 *
 * Without it a manifest could lose its last ten thousand entries — a truncated write,
 * a disk that filled — and still verify, because verification only checks the entries
 * that are listed. The digest is what makes "the list is complete" checkable rather
 * than assumed.
 */
const digestOfEntries = (entries: readonly ManifestEntry[]): string => {
  const hash = createHash('sha256')
  // Rendered first, then sorted with the default lexicographic comparator. Sorting the
  // strings rather than the objects makes the digest canonical without a hand-written
  // comparator, so re-serialising a manifest in a different order is not corruption.
  for (const line of entries.map((e) => `${e.path}|${e.bytes}|${e.sha256}`).sort()) {
    hash.update(`${line}\n`)
  }
  return hash.digest('hex')
}

interface WalkedFile {
  readonly absolute: string
  readonly relative: string
}

/** Depth-first, sorted, files only. Anything else is reported rather than guessed at. */
const walkFiles = async (
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

const countRows = (db: Db, table: string): number => {
  // Table names are compile-time constants from this module, never input. An
  // un-grouped COUNT(*) always answers with exactly one row, so there is no absent
  // case to branch on.
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  return row.n
}

/** SQLite's own verdict, as one word. `simple` asks for the scalar, not a row set. */
const integrityCheck = (db: Db): string => String(db.pragma('integrity_check', { simple: true }))

interface PhotoRow {
  readonly id: string
  readonly eventId: string
  readonly contentHash: string
  /** `photo` or `clip`, which decides which renditions this row owns. */
  readonly mediaKind: string
  /** A clip's poster is a second file under a second digest; `null` on a photograph. */
  readonly posterHash: string | null
}

interface LedgerRow {
  readonly id: number
  readonly name: string
  readonly checksum: string
}

/** Every rendition is a JPEG except the one that is an mp4, as `fsMediaStore` names it. */
const MEDIA_EXTENSION: Readonly<Record<string, string>> = { video: 'mp4' }

/** The path `fsMediaStore` lays an object down at, relative to the media root. */
const mediaPathOf = (eventId: string, contentHash: string, variant: string): string =>
  `${eventId}/${variant}/${contentHash.slice(0, 2)}/${contentHash}.${MEDIA_EXTENSION[variant] ?? 'jpg'}`

/**
 * Every file one row owns, as the media store laid it down.
 *
 * A photograph has three renditions under one digest; a clip has an mp4 under its own
 * and a poster under a **second** one, because the store's invariant is that the name of
 * a file is the hash of that file. Walking `MEDIA_VARIANTS` alone would have reported
 * every clip in an album as three missing photo files while quietly not accounting for
 * the two real ones — and a backup that silently omits a kind of content is precisely
 * what the reconciliation below exists to make impossible.
 */
const expectedPathsOf = (
  photo: PhotoRow,
): readonly { readonly variant: string; readonly path: string }[] => {
  if (photo.mediaKind !== 'clip') {
    return MEDIA_VARIANTS.map((variant) => ({
      variant,
      path: mediaPathOf(photo.eventId, photo.contentHash, variant),
    }))
  }
  // A clip row with no poster digest is a corrupt row; the repository refuses it on
  // read. Here the archive is the last chance to notice, so it falls back to the
  // video's digest and lets the missing-media list report what is not there.
  const poster = photo.posterHash ?? photo.contentHash
  return [
    { variant: 'video', path: mediaPathOf(photo.eventId, photo.contentHash, 'video') },
    { variant: 'poster', path: mediaPathOf(photo.eventId, poster, 'poster') },
  ]
}

/**
 * Everything read out of the snapshot, in one open/close.
 *
 * Opened **read-only**, which is load-bearing rather than tidy: a read-write open runs
 * `journal_mode = WAL` (see `applyPragmas`), and that rewrites a byte in the database
 * header. The file's sha256 would then differ from the one the manifest records, so
 * merely verifying an archive would invalidate it.
 */
const readSnapshot = (
  path: string,
): {
  integrityCheck: string
  migrations: LedgerRow[]
  counts: BackupManifest['counts']
  photos: PhotoRow[]
} => {
  const db = openDatabase({ path, readonly: true })
  try {
    const verdict = integrityCheck(db)

    const migrationRows = db
      .prepare('SELECT id, name, checksum FROM schema_migrations ORDER BY id')
      .all() as LedgerRow[]

    const photos = db
      .prepare(
        `SELECT id, event_id AS eventId, content_hash AS contentHash,
                media_kind AS mediaKind, poster_hash AS posterHash
           FROM photos`,
      )
      .all() as PhotoRow[]

    return {
      integrityCheck: verdict,
      migrations: migrationRows,
      counts: {
        users: countRows(db, 'users'),
        events: countRows(db, 'events'),
        guests: countRows(db, 'guests'),
        photos: photos.length,
        reactions: countRows(db, 'reactions'),
        // Filled in once the media half has been walked.
        mediaFiles: 0,
      },
      photos,
    }
  } finally {
    closeDatabase(db)
  }
}

// ---------------------------------------------------------------------- backup --

export interface BackupOptions {
  readonly databasePath: string
  readonly mediaRoot: string
  /** Created by this call. Must not already exist with anything in it. */
  readonly destination: string
  /** Injected, so a test can assert the stamp and the module never reads the clock. */
  readonly now: Date
  readonly appVersion: string
  readonly onProgress?: (line: string) => void
}

export interface BackupResult {
  readonly destination: string
  readonly manifest: BackupManifest
}

export const createBackup = async ({
  databasePath,
  mediaRoot,
  destination,
  now,
  appVersion,
  onProgress = () => {},
}: BackupOptions): Promise<BackupResult> => {
  const sourceDatabase = resolve(databasePath)
  const sourceMedia = resolve(mediaRoot)
  const archive = resolve(destination)

  // A directory is the common miss — `--database` given the data root rather than the
  // file inside it — and it has to be caught here, or `looksLikeSqlite` reads it and
  // the operator gets `EISDIR` instead of a sentence.
  const sourceInfo = await stat(sourceDatabase).catch(() => null)
  if (sourceInfo === null || !sourceInfo.isFile()) {
    throw new BackupError(`There is no database file at ${sourceDatabase}`)
  }
  if (!(await looksLikeSqlite(sourceDatabase))) {
    throw new BackupError(
      `${sourceDatabase} is not a SQLite database: it does not start with the SQLite ` +
        `header. Check --database, or point it at the file the server is configured ` +
        `with (DATABASE_PATH).`,
    )
  }

  // A backup that overwrote a previous one would destroy the only other copy at the
  // moment the operator is trying to make a second.
  const occupants = await readdir(archive).catch(() => [])
  if (occupants.length > 0) {
    throw new BackupError(
      `${archive} already exists and is not empty. Back up to a new directory rather ` +
        `than over the top of an older archive.`,
    )
  }
  await mkdir(archive, { recursive: true })

  // ------------------------------------------------------- the database half --
  // First, deliberately. See the class docstring: an upload that lands after this
  // point is simply not in this backup, which is recoverable; the other ordering
  // produces rows pointing at bytes nobody copied, which is not.
  const snapshotPath = join(archive, DATABASE_FILE)
  onProgress(`Snapshotting the database with VACUUM INTO -> ${DATABASE_FILE}`)

  const live = openDatabase({ path: sourceDatabase })
  try {
    // The one correct way to copy an open SQLite database. `VACUUM INTO` fails if the
    // target exists, which is a guard worth keeping rather than working around.
    live.prepare('VACUUM INTO ?').run(snapshotPath)
  } catch (cause) {
    throw new BackupError(
      `VACUUM INTO failed, so no consistent snapshot could be taken: ` + `${messageOf(cause)}`,
    )
  } finally {
    closeDatabase(live)
  }

  const snapshot = readSnapshot(snapshotPath)
  if (snapshot.integrityCheck !== 'ok') {
    throw new BackupError(
      `The snapshot failed PRAGMA integrity_check (${snapshot.integrityCheck}). The ` +
        `source database at ${sourceDatabase} is damaged; do not overwrite your last ` +
        `good backup with this one.`,
    )
  }
  const database = await streamThroughSha256(snapshotPath, null)
  onProgress(
    `  ${snapshot.counts.events} event(s), ${snapshot.counts.photos} photo row(s), ` +
      `integrity_check ok`,
  )

  // ---------------------------------------------------------- the media half --
  onProgress(`Copying the media root ${sourceMedia}`)
  const skipped: string[] = []
  const files = await walkFiles(sourceMedia, skipped)

  const entries: ManifestEntry[] = []
  let mediaBytes = 0
  for (const file of files) {
    const posix = toPosix(file.relative)
    if (!isContainedPath(posix)) {
      // A name the manifest format cannot carry: a backslash or a colon in a filename,
      // which POSIX allows and this archive's `/`-separated paths cannot express. Named
      // and left behind, like a staging file, rather than copied — copying it would
      // produce an archive that this build's own reader then refuses, and a backup that
      // reports failure after writing every byte is the worst of both outcomes.
      skipped.push(`${posix}: the name cannot be written as an archive path`)
      continue
    }
    const copied = await streamThroughSha256(file.absolute, join(archive, MEDIA_DIR, file.relative))
    entries.push({ path: posix, bytes: copied.bytes, sha256: copied.sha256 })
    mediaBytes += copied.bytes
  }

  // --------------------------------------------- do the two halves agree? --
  const captured = new Set(entries.map((entry) => entry.path))
  const expected = new Set<string>()
  const missingMedia: BackupManifest['missingMedia'] = []

  for (const photo of snapshot.photos) {
    for (const { variant, path } of expectedPathsOf(photo)) {
      expected.add(path)
      if (!captured.has(path)) {
        missingMedia.push({
          photoId: photo.id,
          eventId: photo.eventId,
          contentHash: photo.contentHash,
          variant,
        })
      }
    }
  }
  const unreferencedMediaFiles = entries.filter((entry) => !expected.has(entry.path)).length

  const manifest: BackupManifest = {
    format: ARCHIVE_FORMAT,
    createdAt: now.toISOString(),
    appVersion,
    source: { databasePath: sourceDatabase, mediaRoot: sourceMedia },
    database: {
      file: DATABASE_FILE,
      bytes: database.bytes,
      sha256: database.sha256,
      integrityCheck: snapshot.integrityCheck,
    },
    migrations: snapshot.migrations,
    counts: { ...snapshot.counts, mediaFiles: entries.length },
    media: { bytes: mediaBytes, entries, entriesDigest: digestOfEntries(entries) },
    missingMedia,
    unreferencedMediaFiles,
    skipped,
  }

  await writeFile(join(archive, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  onProgress(`  ${entries.length} media file(s), ${mediaBytes} byte(s)`)

  return { destination: archive, manifest }
}

// ---------------------------------------------------------------------- verify --

export interface VerifyOptions {
  /**
   * Recompute every checksum. Off, this checks structure, sizes and the entry digest
   * only — enough to catch a truncated or half-copied archive in seconds, not enough
   * to catch a file whose bytes rotted while its length stayed the same.
   */
  readonly deep: boolean
  /** The migrations this build knows, so the archive can be checked against them. */
  readonly migrations: readonly Migration[]
  readonly onProgress?: (line: string) => void
}

export interface VerifyReport {
  readonly ok: boolean
  readonly manifest: BackupManifest | null
  /** Reasons this archive must not be relied on. */
  readonly problems: readonly string[]
  /** True of the archive, worth knowing, not a reason to refuse it. */
  readonly warnings: readonly string[]
  readonly checkedFiles: number
  readonly deep: boolean
}

export const readManifest = async (archive: string): Promise<BackupManifest> => {
  const path = join(resolve(archive), MANIFEST_FILE)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new BackupError(
      `No ${MANIFEST_FILE} in ${resolve(archive)}. Point this at the archive directory ` +
        `itself, not at the directory holding several of them.`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new BackupError(`${path} is not valid JSON: ${messageOf(cause)}`)
  }

  const result = manifestSchema.safeParse(parsed)
  if (!result.success) {
    throw new BackupError(
      `${path} is not a manifest this build understands:\n` +
        result.error.issues
          .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
          .join('\n'),
    )
  }
  if (result.data.format !== ARCHIVE_FORMAT) {
    throw new BackupError(
      `${path} is format ${result.data.format}; this build reads ${ARCHIVE_FORMAT}.`,
    )
  }
  return result.data
}

/**
 * Proves an archive is intact before anyone relies on it.
 *
 * What this catches: a missing or unreadable manifest, a manifest this build cannot
 * read, a database file that is absent, the wrong length, or whose bytes have changed;
 * a database that fails `PRAGMA integrity_check`; any media file that is absent or the
 * wrong length, and (deep) any whose bytes have changed; an entry list that has been
 * truncated; and an archive whose migration ledger this build does not recognise,
 * which is the case where a restore would boot into `MigrationError` rather than a
 * working wall.
 *
 * What it does not catch, stated plainly because a backup check that oversells itself
 * is worse than none:
 *
 * - **Tampering with contents.** The checksums are unkeyed. Anyone who can edit the
 *   archive can recompute them, entry digest included, so this detects damage and not
 *   an adversary. The exception is the one that mattered: where a manifest *points*.
 *   `entry.path` and `database.file` are constrained at the parse (`isContainedPath`),
 *   so a manifest can no longer name a location outside the archive — a restore that
 *   overwrites the compiled server was the difference between a useless backup and code
 *   execution. Substituting the bytes of any file *inside* the archive remains entirely
 *   possible, and the database is one of those files.
 * - **A faithful copy of already-wrong data.** `integrity_check` proves the B-trees
 *   are sound, not that a photo row points at the caption a guest actually wrote.
 * - **Rot after the check.** A verified archive is a statement about one moment. Files
 *   on a disk that is failing will pass today and fail next month; re-verify before
 *   relying on it, which is why `restore` verifies rather than trusting an old result.
 * - **Anything outside these two paths.** `.env` is not in here. Restoring photos with
 *   a different `GUEST_TOKEN_SECRET` invalidates every outstanding guest token, and a
 *   different `SESSION_SECRET` logs every host out. Back the secrets up separately.
 */
export const verifyBackup = async (
  archive: string,
  { deep, migrations, onProgress = () => {} }: VerifyOptions,
): Promise<VerifyReport> => {
  const root = resolve(archive)
  const problems: string[] = []
  const warnings: string[] = []
  let checkedFiles = 0
  let ledger: LedgerRow[] | null = null

  const manifest = await readManifest(root)

  // -------------------------------------------------------------- database --
  const databasePath = join(root, manifest.database.file)
  const databaseStat = await stat(databasePath).catch(() => null)
  if (databaseStat === null) {
    problems.push(`${manifest.database.file} is missing from the archive`)
  } else if (databaseStat.size !== manifest.database.bytes) {
    problems.push(
      `${manifest.database.file} is ${databaseStat.size} bytes, the manifest says ` +
        `${manifest.database.bytes}`,
    )
  } else {
    checkedFiles += 1
    if (deep) {
      onProgress(`Checksumming ${manifest.database.file}`)
      const actual = await streamThroughSha256(databasePath, null)
      if (actual.sha256 !== manifest.database.sha256) {
        problems.push(
          `${manifest.database.file} does not match its recorded checksum: the database ` +
            `in this archive is not the one that was backed up`,
        )
      }
    }
    // Cheap, and the two most valuable things to know about a backup: that the pages
    // are sound, and that the server will agree to start against it.
    try {
      const db = openDatabase({ path: databasePath, readonly: true })
      try {
        const verdict = integrityCheck(db)
        if (verdict !== 'ok') {
          problems.push(`the archived database fails integrity_check: ${verdict}`)
        }
        ledger = db
          .prepare('SELECT id, name, checksum FROM schema_migrations ORDER BY id')
          .all() as LedgerRow[]
      } finally {
        closeDatabase(db)
      }
    } catch (cause) {
      problems.push(`the archived database could not be opened: ` + `${messageOf(cause)}`)
    }
  }

  // ------------------------------------------------------- migration ledger --
  // Read out of the archived database rather than trusted from the manifest, because
  // the ledger is what `src/main/container.ts` will check at boot. An archive whose
  // ledger this build rejects restores into a wall that never comes up, and the place
  // to discover that is here, before anything has been overwritten.
  if (ledger !== null) {
    const known = new Map(migrations.map((migration) => [migration.id, migration]))
    for (const row of ledger) {
      const migration = known.get(row.id)
      if (migration === undefined) {
        problems.push(
          `the archive has migration ${row.id} (${row.name}) applied, which this build does ` +
            `not know. It was taken from a newer EventSlide; restoring it here would refuse ` +
            `to start. Restore it with the version that produced it.`,
        )
        continue
      }
      if (checksumOf(migration) !== row.checksum) {
        problems.push(
          `migration ${row.id} (${row.name}) in the archive has a different checksum from ` +
            `the one this build carries. The server refuses to start on that, so this ` +
            `archive and this build are not a pair.`,
        )
      }
    }

    const pending = migrations.filter(
      (migration) => !ledger?.some((row) => row.id === migration.id),
    )
    if (pending.length > 0) {
      warnings.push(
        `the archive predates this build: ${pending.length} migration(s) will be applied on ` +
          `the first boot after restoring (${pending.map((m) => m.name).join(', ')})`,
      )
    }

    if (ledger.length !== manifest.migrations.length) {
      problems.push(
        `the manifest records ${manifest.migrations.length} applied migration(s) but the ` +
          `archived database has ${ledger.length}`,
      )
    }
  }

  // ----------------------------------------------------------------- media --
  if (digestOfEntries(manifest.media.entries) !== manifest.media.entriesDigest) {
    problems.push(
      `the manifest's media entry list does not match its own digest: the manifest is ` +
        `damaged or was truncated`,
    )
  }
  if (manifest.media.entries.length !== manifest.counts.mediaFiles) {
    problems.push(
      `the manifest lists ${manifest.media.entries.length} media entries but claims ` +
        `${manifest.counts.mediaFiles} files`,
    )
  }

  if (deep) onProgress(`Checksumming ${manifest.media.entries.length} media file(s)`)
  for (const entry of manifest.media.entries) {
    const path = join(root, MEDIA_DIR, fromPosix(entry.path))
    const info = await stat(path).catch(() => null)
    if (info === null) {
      problems.push(`media/${entry.path} is missing from the archive`)
      continue
    }
    if (info.size !== entry.bytes) {
      problems.push(`media/${entry.path} is ${info.size} bytes, the manifest says ${entry.bytes}`)
      continue
    }
    checkedFiles += 1
    if (!deep) continue
    const actual = await streamThroughSha256(path, null)
    if (actual.sha256 !== entry.sha256) {
      problems.push(`media/${entry.path} does not match its recorded checksum`)
    }
  }

  // ------------------------------------------ what the backup already knew --
  const [firstGap] = manifest.missingMedia
  if (firstGap !== undefined) {
    warnings.push(
      `${manifest.missingMedia.length} photo row(s) had no bytes on disk when the backup ` +
        `ran; restoring this archive reproduces that gap (first: ${firstGap.photoId})`,
    )
  }
  if (manifest.unreferencedMediaFiles > 0) {
    warnings.push(
      `${manifest.unreferencedMediaFiles} media file(s) are named by no photo row — normal ` +
        `for a backup taken while guests were uploading, and harmless`,
    )
  }
  for (const note of manifest.skipped) warnings.push(`skipped during backup: ${note}`)

  return { ok: problems.length === 0, manifest, problems, warnings, checkedFiles, deep }
}

// --------------------------------------------------------------------- restore --

export interface RestoreTarget {
  readonly databasePath: string
  readonly mediaRoot: string
  readonly databaseBytes: number | null
  readonly mediaFiles: number
  readonly mediaBytes: number
  /** A `-wal` or `-shm` beside the database: a server is probably still running. */
  readonly liveJournal: boolean
  readonly occupied: boolean
}

/** What restoring would destroy. Read-only; the CLI prints this before it acts. */
export const inspectRestoreTarget = async (
  databasePath: string,
  mediaRoot: string,
): Promise<RestoreTarget> => {
  const database = resolve(databasePath)
  const media = resolve(mediaRoot)

  const databaseStat = await stat(database).catch(() => null)
  const liveJournal = (await exists(`${database}-wal`)) || (await exists(`${database}-shm`))

  const skipped: string[] = []
  const files = await walkFiles(media, skipped)
  let mediaBytes = 0
  for (const file of files) {
    const info = await stat(file.absolute).catch(() => null)
    if (info !== null) mediaBytes += info.size
  }

  return {
    databasePath: database,
    mediaRoot: media,
    databaseBytes: databaseStat?.size ?? null,
    mediaFiles: files.length,
    mediaBytes,
    liveJournal,
    occupied: databaseStat !== null || files.length > 0,
  }
}

export interface RestoreOptions {
  readonly archive: string
  readonly databasePath: string
  readonly mediaRoot: string
  /** Required to write over anything at all. Nothing else unlocks it. */
  readonly force: boolean
  readonly migrations: readonly Migration[]
  readonly onProgress?: (line: string) => void
}

export interface RestoreResult {
  readonly manifest: BackupManifest
  readonly target: RestoreTarget
  readonly mediaFilesWritten: number
  /** Migrations the restored database still needed. Empty is the ordinary case. */
  readonly migrationsApplied: readonly number[]
}

/**
 * The one window in this product where an interrupted operation leaves an operator with
 * neither the data from before nor complete data from after, said out loud.
 *
 * The window is deliberate and stays: the media root is replaced in place because
 * copying several gigabytes twice to get atomicity is not a price a self-hosted box can
 * pay, and the archive has been proven complete before anything is destroyed. What was
 * missing was not a smaller window but a legible one. "The restore is incomplete" on
 * its own sends somebody looking for a recovery procedure that does not exist; the
 * facts that matter are that **nothing is lost while the archive is readable** and that
 * **the same command finishes the job** — true, because a restore verifies the archive
 * again and rewrites both halves from scratch every time, and because the media copy is
 * therefore idempotent.
 *
 * `--force` is named because it is now required and was not before: the target holds a
 * partial installation, so the refusal in `restoreBackup` would otherwise stop the
 * re-run that fixes it.
 */
const incompleteRestore = (
  archiveRoot: string,
  target: RestoreTarget,
  entry: ManifestEntry,
  reason: string,
  written: number,
  total: number,
): BackupError =>
  new BackupError(
    `media/${entry.path} could not be restored: ${reason}.\n` +
      `  archive   ${archiveRoot}\n` +
      `  database  ${target.databasePath}  (already replaced from the archive)\n` +
      `  media     ${target.mediaRoot}  (${written} of ${total} file(s) written)\n` +
      `The target is now incomplete: the restored database, part of the restored media, ` +
      `and nothing of what was there before.\n` +
      `Nothing is lost while that archive is readable. Once the cause is fixed — space, ` +
      `permissions, a disconnected drive — re-run the same restore with --force, which ` +
      `the target now needs because it is no longer empty: the copy is idempotent, so a ` +
      `second run rewrites both halves and costs only time. A failure that repeats is a ` +
      `property of the target, not of the archive.`,
  )

/**
 * Writes an archive over a database and a media root.
 *
 * Destructive by definition, so the order is: verify everything, refuse if the target
 * holds anything and `force` was not given, and only then write. The archive is
 * checked in full first because the one unrecoverable sequence is deleting a good
 * media root and *then* discovering the replacement is short of four hundred files.
 *
 * The database goes in via a temporary sibling and a rename, so a restore interrupted
 * mid-copy leaves the previous database where it was rather than half of a new one.
 * The media root is replaced in place: copying several gigabytes twice to get the same
 * property is not a trade a self-hosted box can pay, and by this point the archive has
 * already been proven complete.
 */
export const restoreBackup = async ({
  archive,
  databasePath,
  mediaRoot,
  force,
  migrations,
  onProgress = () => {},
}: RestoreOptions): Promise<RestoreResult> => {
  const root = resolve(archive)

  // The refusal comes first because it is free, and checksumming forty gigabytes
  // before telling an operator that they needed `--force` is forty gigabytes of
  // waiting for an answer that was known at the start. The safety property is
  // unaffected: the archive is still proven before anything is destroyed, below.
  const target = await inspectRestoreTarget(databasePath, mediaRoot)
  if (target.occupied && !force) {
    throw new BackupError(
      `Refusing to overwrite an existing installation.\n` +
        `  database  ${target.databasePath}` +
        `${target.databaseBytes === null ? '  (absent)' : `  (${target.databaseBytes} bytes)`}\n` +
        `  media     ${target.mediaRoot}  (${target.mediaFiles} file(s), ${target.mediaBytes} bytes)\n` +
        `Restore into an empty location, or pass --force to destroy the above.`,
    )
  }

  onProgress(`Verifying ${root} before writing anything`)
  const report = await verifyBackup(root, { deep: true, migrations, onProgress })
  if (!report.ok || report.manifest === null) {
    throw new BackupError(
      `Refusing to restore from a damaged archive:\n` +
        report.problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }
  const manifest = report.manifest

  // Every media path is turned into a location here, before a single byte is written,
  // so that the second containment gate refuses a manifest while the installation is
  // still whole. `entrySchema` has already refused anything that could fail this; a
  // belt that only fastens halfway through the operation is not a belt. See
  // `resolveInside`.
  const copies = manifest.media.entries.map((entry) => {
    const relative = fromPosix(entry.path)
    return {
      entry,
      from: resolveInside(join(root, MEDIA_DIR), relative),
      to: resolveInside(target.mediaRoot, relative),
    }
  })

  // ------------------------------------------------------------- database --
  const staged = `${target.databasePath}.restoring`
  await rm(staged, { force: true })
  onProgress(`Restoring the database to ${target.databasePath}`)
  const copied = await streamThroughSha256(join(root, manifest.database.file), staged)
  if (copied.sha256 !== manifest.database.sha256) {
    await rm(staged, { force: true })
    throw new BackupError(
      `The database changed while it was being copied out of the archive. Nothing was ` +
        `overwritten.`,
    )
  }

  // The journal files belong to the database being replaced; leaving them beside a
  // different database file is how a "successful" restore opens as corrupt.
  await rm(`${target.databasePath}-wal`, { force: true })
  await rm(`${target.databasePath}-shm`, { force: true })
  await rm(target.databasePath, { force: true })
  await rename(staged, target.databasePath)

  // -------------------------------------------------------------- media --
  onProgress(`Restoring ${manifest.media.entries.length} media file(s) to ${target.mediaRoot}`)
  await rm(target.mediaRoot, { recursive: true, force: true })
  await mkdir(target.mediaRoot, { recursive: true })

  let written = 0
  for (const { entry, from, to } of copies) {
    let failure: string | null = null
    try {
      const restored = await streamThroughSha256(from, to)
      if (restored.sha256 !== entry.sha256) {
        failure = 'it changed while it was being copied out of the archive'
      }
    } catch (cause) {
      // A read that failed, a disk that filled, an archive that was unplugged. Every
      // one of them lands here rather than propagating raw, because by this point the
      // operator needs the state of their installation explained, not an errno.
      failure = messageOf(cause)
    }
    if (failure !== null) {
      throw incompleteRestore(root, target, entry, failure, written, copies.length)
    }
    written += 1
  }

  // ------------------------------------------------------ prove it boots --
  // The same call `src/main/container.ts` makes at startup, run here so a ledger the
  // server would reject is discovered by the person doing the restore rather than by a
  // host whose wall will not come up.
  onProgress('Checking the restored database against this build')
  const db = openDatabase({ path: target.databasePath })
  let migrationsApplied: readonly number[]
  try {
    migrationsApplied = migrate(db, migrations)
  } catch (cause) {
    throw new BackupError(
      cause instanceof MigrationError
        ? `The restored database will not start with this build: ${cause.message}`
        : `The restored database could not be checked: ` + `${messageOf(cause)}`,
    )
  } finally {
    closeDatabase(db)
  }

  return { manifest, target, mediaFilesWritten: written, migrationsApplied }
}
