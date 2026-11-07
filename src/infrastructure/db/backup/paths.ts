import { resolve, sep } from 'node:path'
import { z } from 'zod'
import { BackupError } from './backupError'

/** Where a path named by an archive may point: containment, and the `/` form manifests use. */

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
export const isContainedPath = (value: string): boolean => {
  if (hasControlCharacter(value)) return false
  if (value.includes('\\') || value.includes(':')) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

const CONTAINED_PATH_MESSAGE =
  'must stay inside the archive: a relative path with "/" separators, no "." or ".." or ' +
  'empty segment, no drive letter, no backslash, no control character'

/** A path in a manifest that this build will turn into a location on disk. */
export const containedPath = z.string().min(1).refine(isContainedPath, {
  error: CONTAINED_PATH_MESSAGE,
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

/** Manifest paths are `/`-separated so an archive taken on Windows restores on Linux. */
export const toPosix = (path: string): string => path.split(sep).join('/')

export const fromPosix = (path: string): string => path.split('/').join(sep)
