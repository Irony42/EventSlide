import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { statfsDiskSpaceChecker } from './statfsDiskSpaceChecker'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eventslide-diskspace-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('statfsDiskSpaceChecker', () => {
  it('reports a positive number of free bytes for a real directory', async () => {
    const freeBytes = await statfsDiskSpaceChecker.freeBytes(dir)

    // Not a specific number — that would pin the machine running the suite — but a
    // real `statfs` answer on a directory that exists is always a positive integer.
    expect(freeBytes).not.toBeNull()
    expect(freeBytes).toBeGreaterThan(0)
    expect(Number.isInteger(freeBytes)).toBe(true)
  })

  it('answers null for a path that does not exist, rather than throwing', async () => {
    const freeBytes = await statfsDiskSpaceChecker.freeBytes(join(dir, 'does', 'not', 'exist'))

    expect(freeBytes).toBeNull()
  })
})
