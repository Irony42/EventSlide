import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WALL_SOUND_TONES = ['chime', 'bell', 'drop', 'pop'] as const
const ROOT = join(__dirname, '..')
const PER_FILE_BUDGET = 25_000
const TOTAL_BUDGET = 80_000

describe('the wall sounds (spec 12)', () => {
  const files = WALL_SOUND_TONES.map((tone) => join(ROOT, 'web', 'public', 'sounds', `${tone}.mp3`))

  it('ships one mp3 per tone of the closed list', () => {
    for (const file of files) {
      expect(existsSync(file), file).toBe(true)
      // Either an ID3 tag ('ID3') or straight into an mp3 frame (11-bit sync word).
      const head = readFileSync(file).subarray(0, 3)
      const frame = head[0] === 0xff && (head[1]! & 0xe0) === 0xe0
      expect(frame || head.toString('latin1') === 'ID3', file).toBe(true)
    }
  })

  it('keeps each file under 25 kB and the four together under 80 kB', () => {
    const sizes = files.map((file) => statSync(file).size)
    for (const size of sizes) expect(size).toBeLessThanOrEqual(PER_FILE_BUDGET)
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(TOTAL_BUDGET)
  })

  it('carries its licence note, and the script that makes the files', () => {
    const note = readFileSync(join(ROOT, 'web', 'public', 'licenses', 'SOUNDS.txt'), 'utf8')
    expect(note).toContain('CC0')
    expect(note).toContain('tools/sounds/generate.mjs')
    expect(existsSync(join(ROOT, 'tools', 'sounds', 'generate.mjs'))).toBe(true)
  })
})
