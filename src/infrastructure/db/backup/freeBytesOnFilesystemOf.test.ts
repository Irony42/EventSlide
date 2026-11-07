import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { freeBytesOnFilesystemOf } from './createBackup'

let dir: string | null = null

afterEach(async () => {
  if (dir !== null) await rm(dir, { recursive: true, force: true })
  dir = null
})

describe('freeBytesOnFilesystemOf', () => {
  it('asks the nearest ancestor that exists when the archive directory is not there yet', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eventslide-free-'))

    const free = await freeBytesOnFilesystemOf(join(dir, 'backups', '2026-11-07', 'archive'))

    expect(free).toBeGreaterThan(0)
  })
})
