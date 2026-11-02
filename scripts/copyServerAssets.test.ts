import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyServerAssets, SERVER_ASSET_DIRECTORIES } from './copyServerAssets'

const SRC = join(__dirname, '..', 'src')

describe('copyServerAssets', () => {
  it('copies the book fonts and their licence next to the compiled server', async () => {
    const out = await mkdtemp(join(tmpdir(), 'es-assets-'))
    try {
      await copyServerAssets(SRC, out)

      const copied = await readdir(join(out, 'infrastructure/media/fonts'))
      expect(copied).toEqual(await readdir(join(SRC, 'infrastructure/media/fonts')))
      expect(copied).toContain('OFL-Noto.txt')
      expect(copied.filter((name) => name.endsWith('.ttf'))).toHaveLength(4)
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  })

  it('names every directory the server reads at run time', async () => {
    expect(SERVER_ASSET_DIRECTORIES).toEqual(['infrastructure/media/fonts'])
  })
})
