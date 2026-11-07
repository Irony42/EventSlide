import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { statfsDiskSpaceChecker } from '../../system/statfsDiskSpaceChecker'
import { freeBytesOnFilesystemOf } from './createBackup'

let dir: string | null = null

afterEach(async () => {
  vi.restoreAllMocks()
  if (dir !== null) await rm(dir, { recursive: true, force: true })
  dir = null
})

describe('freeBytesOnFilesystemOf', () => {
  it('asks the nearest ancestor that exists when the archive directory is not there yet', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eventslide-free-'))
    const probed: string[] = []
    const real = statfsDiskSpaceChecker.freeBytes
    vi.spyOn(statfsDiskSpaceChecker, 'freeBytes').mockImplementation(async (path) => {
      probed.push(path)
      return real(path)
    })

    const free = await freeBytesOnFilesystemOf(join(dir, 'backups', '2026-11-07', 'archive'))

    expect(free).toBeGreaterThan(0)
    expect(probed.at(-1)).toBe(resolve(dir))
  })
})
