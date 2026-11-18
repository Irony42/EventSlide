import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * No two modules in one folder may share a name once case and extension are set aside (CLAUDE.md §9,
 * trap 13).
 *
 * On a case-blind file system, `tsc` takes `albumDeletion.test.ts` and `AlbumDeletion.test.tsx` for
 * one root file and keeps the first extension it prefers, so the other is **never type-checked** on
 * Windows while Linux CI checks both. A required field added to a DTO went red only in CI, on a
 * fixture the local `npm run typecheck` had silently skipped. Read from `git ls-files`, so an
 * untracked scratch file does not fail it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODULE = /\.(?:[cm]?[jt]sx?)$/

/** Groups of tracked module paths that a case-blind `tsc` would read as one root file. */
const caseClashes = (paths: readonly string[]): string[][] => {
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    if (!MODULE.test(path)) continue
    const key = path.replace(MODULE, '').toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), path])
  }
  return [...groups.values()].filter((group) => group.length > 1)
}

describe('module names a case-blind file system can tell apart', () => {
  it('finds the pair that hid a test file from tsc on Windows', () => {
    expect(
      caseClashes([
        'web/src/features/admin/albumDeletion.test.ts',
        'web/src/features/admin/AlbumDeletion.test.tsx',
        'web/src/features/admin/AlbumDeletionBand.tsx',
      ]),
    ).toEqual([
      [
        'web/src/features/admin/albumDeletion.test.ts',
        'web/src/features/admin/AlbumDeletion.test.tsx',
      ],
    ])
  })

  it('leaves the same name in two folders alone', () => {
    expect(caseClashes(['web/src/a/index.ts', 'web/src/b/index.ts'])).toEqual([])
  })

  it('has no such pair in the repository', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    expect(caseClashes(tracked)).toEqual([])
  })
})
