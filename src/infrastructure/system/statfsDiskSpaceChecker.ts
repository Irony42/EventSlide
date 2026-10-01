import { statfs } from 'node:fs/promises'
import type { DiskSpaceChecker } from '../../application/ports/diskSpace'

/**
 * The real probe behind the free-disk-space guard (G3-06 / P4-10).
 *
 * `bavail` is blocks available to an **unprivileged** process, not `bfree`, which also
 * counts blocks the filesystem reserves for root — using `bfree` would report headroom
 * a guest's upload could never actually use.
 *
 * `null` on any failure, rather than a thrown rejection: `evaluateDiskSpace` treats
 * "could not tell" the same as "not enough", which is the fail-closed posture the rest
 * of the box already takes (a boot with no secret refuses rather than runs weakened;
 * `GET /api/ready` answers `unavailable` rather than `ok` when a probe throws).
 */
export const statfsDiskSpaceChecker: DiskSpaceChecker = {
  freeBytes: async (path: string): Promise<number | null> => {
    try {
      const { bavail, bsize } = await statfs(path)
      return bavail * bsize
    } catch {
      return null
    }
  },
}
