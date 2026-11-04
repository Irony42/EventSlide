import { readFileSync } from 'node:fs'
import { Blob as NodeBlob } from 'node:buffer'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cutContainer } from './cutContainer'

/**
 * The on-phone cut (spec 16, PR 3), against two real eight-second MP4s: a keyframe every
 * second, one with its index at the end (what a phone writes) and one with it first.
 */

/** Node's own `Blob`: jsdom's has no `arrayBuffer`, and the cutter reads through it. */
const fixture = (name: string): Blob =>
  new NodeBlob([
    readFileSync(join(process.cwd(), 'web/src/features/guest-upload/fixtures', name)),
  ]) as unknown as Blob

const reader = (blob: Blob) => (from: number, to: number) => blob.slice(from, to).arrayBuffer()

/** The output is a jsdom `Blob`, which is read the way a browser would. */
const bytesOf = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reading = new FileReader()
    reading.onload = () => resolve(new Uint8Array(reading.result as ArrayBuffer))
    reading.onerror = () => reject(new Error('unreadable'))
    reading.readAsArrayBuffer(blob)
  })

const fourcc = (bytes: Uint8Array, at: number): string =>
  String.fromCharCode(...bytes.slice(at, at + 4))

describe.each(['moov-at-end.mp4', 'moov-first.mp4'])('cutContainer on %s', (name) => {
  const source = fixture(name)

  it('keeps the part asked for, starting on the keyframe before it', async () => {
    const cut = await cutContainer(source, 3_500, 6_000, { read: reader(source) })

    expect(cut).not.toBeNull()
    if (cut === null) return
    // Keyframes fall on whole seconds: the extract starts at 3 s, half a second early.
    expect(cut.startMs).toBe(500)
    expect(cut.endMs).toBe(3_000)
  })

  it('sends fewer bytes than the original, and a file that opens with its ftyp', async () => {
    const cut = await cutContainer(source, 3_500, 6_000, { read: reader(source) })

    expect(cut).not.toBeNull()
    if (cut === null) return
    expect(cut.blob.size).toBeLessThan(source.size)
    const head = await bytesOf(cut.blob.slice(0, 12))
    expect(fourcc(head, 4)).toBe('ftyp')
    expect(cut.blob.type).toBe('video/mp4')
  })

  it('cuts from the very start of the recording', async () => {
    const cut = await cutContainer(source, 0, 2_000, { read: reader(source) })

    expect(cut?.startMs).toBe(0)
    expect(cut?.endMs).toBe(2_000)
  })

  it('answers null for bytes that are not a MP4, so the caller falls back', async () => {
    const junk = new NodeBlob([new Uint8Array(4_096).fill(7)]) as unknown as Blob

    expect(await cutContainer(junk, 0, 2_000, { read: reader(junk) })).toBeNull()
  })

  it('answers null when the library cannot even be loaded', async () => {
    const cut = await cutContainer(source, 0, 2_000, {
      read: reader(source),
      load: () => Promise.reject(new Error('offline')),
    })

    expect(cut).toBeNull()
  })
})
