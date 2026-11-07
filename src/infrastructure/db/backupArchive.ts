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
 *   media/<eventId>/<variant>/<ab>/<contentHash>.<ext>   (laid out as `media/mediaLayout.ts` says)
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

export { BackupError } from './backup/backupError'
export {
  ARCHIVE_FORMAT,
  DATABASE_FILE,
  MANIFEST_FILE,
  MEDIA_DIR,
  readManifest,
} from './backup/manifest'
export type { BackupManifest, ManifestEntry } from './backup/manifest'
export { resolveInside } from './backup/paths'
export { createBackup } from './backup/createBackup'
export type { BackupOptions, BackupResult } from './backup/createBackup'
export { verifyBackup } from './backup/verifyBackup'
export type { VerifyOptions, VerifyReport } from './backup/verifyBackup'
export { inspectRestoreTarget, restoreBackup } from './backup/restoreBackup'
export type { RestoreOptions, RestoreResult, RestoreTarget } from './backup/restoreBackup'
