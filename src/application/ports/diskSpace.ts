/**
 * How much room is left on a filesystem, for the free-disk-space guard (G3-06 / P4-10).
 *
 * A port, not a direct `node:fs` call, for the two reasons every other port here exists:
 * `src/application` may not import `node:fs` at all (lint forbids it), and a test must
 * be able to stand in a nearly full disk without filling a real one.
 */
export interface DiskSpaceChecker {
  /**
   * Free bytes on the filesystem that holds `path`, available to this process — or
   * `null` when it could not be read (the directory is gone, a permission error, a
   * platform `statfs` does not support).
   *
   * `path` is expected to already exist: the two paths the guard checks are the
   * directory holding `DATABASE_PATH` and `MEDIA_ROOT`, both created by the server
   * itself at boot, well before any request can reach this.
   */
  freeBytes(path: string): Promise<number | null>
}
