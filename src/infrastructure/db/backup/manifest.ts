import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { containedPath } from './paths'
import { BackupError } from './backupError'
import { messageOf } from './files'

/** The archive format: its constants, the manifest schema, its digest and its reader. */

export interface LedgerRow {
  readonly id: number
  readonly name: string
  readonly checksum: string
}

/** Bumped when the layout or the manifest shape changes in a way a reader must notice. */
export const ARCHIVE_FORMAT = 'eventslide-backup/1'

export const MANIFEST_FILE = 'manifest.json'
export const DATABASE_FILE = 'database.sqlite'
export const MEDIA_DIR = 'media'

const entrySchema = z.object({
  /** Relative to `<archive>/media`, always with `/` separators — and enforced, see above. */
  path: containedPath,
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})

export const manifestSchema = z.object({
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

/**
 * A fingerprint of the entry list itself.
 *
 * Without it a manifest could lose its last ten thousand entries — a truncated write,
 * a disk that filled — and still verify, because verification only checks the entries
 * that are listed. The digest is what makes "the list is complete" checkable rather
 * than assumed.
 */
export const digestOfEntries = (entries: readonly ManifestEntry[]): string => {
  const hash = createHash('sha256')
  // Rendered first, then sorted with the default lexicographic comparator. Sorting the
  // strings rather than the objects makes the digest canonical without a hand-written
  // comparator, so re-serialising a manifest in a different order is not corruption.
  for (const line of entries.map((e) => `${e.path}|${e.bytes}|${e.sha256}`).sort()) {
    hash.update(`${line}\n`)
  }
  return hash.digest('hex')
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
