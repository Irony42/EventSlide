import type { DiskSpaceChecker } from '../ports/diskSpace'

/**
 * A `DiskSpaceChecker` a test drives without touching a real filesystem.
 *
 * Generous by default (10 GB), so a test that is not about this guard never has to
 * think about it — the same posture `testHttpConfig` already takes for every other
 * limit. A test that is about the guard calls `set(path, freeBytes)` for the one path it
 * cares about, or `set(path, null)` to model a path `statfs` could not read.
 */
export class FakeDiskSpaceChecker implements DiskSpaceChecker {
  private readonly overrides = new Map<string, number | null>()

  constructor(private readonly defaultFreeBytes = 10_000_000_000) {}

  set(path: string, freeBytes: number | null): this {
    this.overrides.set(path, freeBytes)
    return this
  }

  async freeBytes(path: string): Promise<number | null> {
    const overridden = this.overrides.get(path)
    return overridden === undefined ? this.defaultFreeBytes : overridden
  }
}
