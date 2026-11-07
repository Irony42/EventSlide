import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isMissing, readdirOrEmpty } from './fsErrors'

const errnoError = (code: string): Error => Object.assign(new Error(code), { code })

describe('isMissing', () => {
  it('is true for ENOENT only', () => {
    expect(isMissing(errnoError('ENOENT'))).toBe(true)
    expect(isMissing(errnoError('ENOTDIR'))).toBe(false)
    expect(isMissing(errnoError('EACCES'))).toBe(false)
  })

  it('is false for anything that is not an error object with a code', () => {
    expect(isMissing(new Error('ENOENT'))).toBe(false)
    expect(isMissing('ENOENT')).toBe(false)
    expect(isMissing(null)).toBe(false)
    expect(isMissing(undefined)).toBe(false)
  })
})

describe('readdirOrEmpty', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-fserrors-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists names, or entries when asked for file types', async () => {
    await writeFile(join(root, 'a.txt'), 'a')
    await mkdir(join(root, 'sub'))

    expect((await readdirOrEmpty(root)).sort()).toEqual(['a.txt', 'sub'])
    const entries = await readdirOrEmpty(root, { withFileTypes: true })
    expect(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)).toEqual([
      'sub',
    ])
  })

  it('answers an empty list for a directory that does not exist', async () => {
    expect(await readdirOrEmpty(join(root, 'nope'))).toEqual([])
    expect(await readdirOrEmpty(join(root, 'nope'), { withFileTypes: true })).toEqual([])
  })

  it('throws any other error, such as listing a file as a directory', async () => {
    const file = join(root, 'a.txt')
    await writeFile(file, 'a')

    await expect(readdirOrEmpty(file)).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
})
