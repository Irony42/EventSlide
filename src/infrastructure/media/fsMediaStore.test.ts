import { mkdir, mkdtemp, readFile, rm, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFsMediaStore } from './fsMediaStore'
import type { MediaStore, MediaVariant } from '../../application/ports/mediaStore'
import { ContentHash } from '../../domain/photos/contentHash'
import { asEventId, type EventId } from '../../domain/shared/ids'

const hashOf = (seed: string): ContentHash => {
  const result = ContentHash.create(seed.repeat(64).slice(0, 64))
  if (!result.ok) throw new Error(`test fixture produced an invalid hash: ${seed}`)
  return result.value
}

const HASH_A = hashOf('a1')
const HASH_B = hashOf('b2')
const WEDDING = asEventId('11111111-1111-4111-8111-111111111111')
const GALA = asEventId('22222222-2222-4222-8222-222222222222')

/** Where the store lays an object down, according to its documented layout. */
const objectPath = (root: string, eventId: EventId, variant: string, hash: ContentHash): string =>
  join(root, eventId, variant, hash.value.slice(0, 2), `${hash.value}.jpg`)

const collect = async (chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const parts: Uint8Array[] = []
  for await (const chunk of chunks) parts.push(chunk)
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('fsMediaStore', () => {
  let root: string
  let store: MediaStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-media-'))
    store = createFsMediaStore({ root })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('round-trips bytes through put and read', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])

    await store.put(WEDDING, HASH_A, 'display', bytes)

    expect(await store.read(WEDDING, HASH_A, 'display')).toEqual(bytes)
  })

  it('creates the directory tree on first write', async () => {
    await store.put(WEDDING, HASH_A, 'thumb', new Uint8Array([9]))

    // event id first, then variant, then a two-character shard: purging an event is
    // one recursive delete, and no directory accumulates tens of thousands of files.
    const shard = HASH_A.value.slice(0, 2)
    const files = await readdir(join(root, WEDDING, 'thumb', shard))
    expect(files).toEqual([`${HASH_A.value}.jpg`])
  })

  it('leaves no temporary file behind after a successful write', async () => {
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))

    const shard = HASH_A.value.slice(0, 2)
    const files = await readdir(join(root, WEDDING, 'display', shard))
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('overwrites an existing object with the same address', async () => {
    // Re-rendering after a pipeline change writes the same address again; the second
    // write must not fail on the existing file.
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([2, 2]))

    expect(await store.read(WEDDING, HASH_A, 'display')).toEqual(new Uint8Array([2, 2]))
  })

  it('keeps two events apart even for identical bytes', async () => {
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))
    await store.put(GALA, HASH_A, 'display', new Uint8Array([2]))

    expect(await store.read(WEDDING, HASH_A, 'display')).toEqual(new Uint8Array([1]))
    expect(await store.read(GALA, HASH_A, 'display')).toEqual(new Uint8Array([2]))
  })

  it('keeps variants of one photo apart', async () => {
    await store.put(WEDDING, HASH_A, 'original', new Uint8Array([1, 1, 1]))
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([2, 2]))
    await store.put(WEDDING, HASH_A, 'thumb', new Uint8Array([3]))

    expect((await store.stat(WEDDING, HASH_A, 'original'))?.byteSize).toBe(3)
    expect((await store.stat(WEDDING, HASH_A, 'display'))?.byteSize).toBe(2)
    expect((await store.stat(WEDDING, HASH_A, 'thumb'))?.byteSize).toBe(1)
  })

  it('reports a missing object as absent rather than throwing', async () => {
    expect(await store.exists(WEDDING, HASH_A, 'display')).toBe(false)
    expect(await store.stat(WEDDING, HASH_A, 'display')).toBeNull()
    expect(await store.read(WEDDING, HASH_A, 'display')).toBeNull()
    expect(await store.openRead(WEDDING, HASH_A, 'display')).toBeNull()
  })

  it('reports an existing object as present', async () => {
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))

    expect(await store.exists(WEDDING, HASH_A, 'display')).toBe(true)
  })

  it('streams an object for the HTTP layer to pipe', async () => {
    const bytes = new Uint8Array(200_000).fill(7)
    await store.put(WEDDING, HASH_A, 'original', bytes)

    const stream = await store.openRead(WEDDING, HASH_A, 'original')

    expect(stream).not.toBeNull()
    expect(await collect(stream!)).toEqual(bytes)
  })

  it('returns null from openRead before committing to a response', async () => {
    // createReadStream reports a missing file asynchronously on the stream, by which
    // point the HTTP layer has already sent a 200. Statting first is what makes a 404
    // possible.
    expect(await store.openRead(WEDDING, hashOf('ff'), 'display')).toBeNull()
  })

  it('reports the content type per variant', async () => {
    await store.put(WEDDING, HASH_A, 'thumb', new Uint8Array([1]))

    expect((await store.stat(WEDDING, HASH_A, 'thumb'))?.contentType).toBe('image/jpeg')
  })

  it('deletes every variant of one photo', async () => {
    await store.put(WEDDING, HASH_A, 'original', new Uint8Array([1]))
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))
    await store.put(WEDDING, HASH_A, 'thumb', new Uint8Array([1]))

    await store.delete(WEDDING, HASH_A)

    expect(await store.exists(WEDDING, HASH_A, 'original')).toBe(false)
    expect(await store.exists(WEDDING, HASH_A, 'display')).toBe(false)
    expect(await store.exists(WEDDING, HASH_A, 'thumb')).toBe(false)
  })

  it('deletes a photo whose variants were never all generated', async () => {
    // The contract is idempotent: a photo that failed part-way through ingest has a
    // display variant and no thumb, and deleting it must still succeed.
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))

    await expect(store.delete(WEDDING, HASH_A)).resolves.toBeUndefined()
  })

  it('deleting a photo that was never stored is not an error', async () => {
    await expect(store.delete(WEDDING, HASH_B)).resolves.toBeUndefined()
  })

  it('leaves other photos alone when deleting one', async () => {
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))
    await store.put(WEDDING, HASH_B, 'display', new Uint8Array([2]))

    await store.delete(WEDDING, HASH_A)

    expect(await store.exists(WEDDING, HASH_B, 'display')).toBe(true)
  })

  it('purges an entire event and nothing else', async () => {
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))
    await store.put(WEDDING, HASH_B, 'thumb', new Uint8Array([1]))
    await store.put(GALA, HASH_A, 'display', new Uint8Array([1]))

    await store.deleteEvent(WEDDING)

    expect(await store.exists(WEDDING, HASH_A, 'display')).toBe(false)
    expect(await store.exists(WEDDING, HASH_B, 'thumb')).toBe(false)
    expect(await store.exists(GALA, HASH_A, 'display')).toBe(true)
  })

  it('purging an event that stored nothing is not an error', async () => {
    await expect(store.deleteEvent(GALA)).resolves.toBeUndefined()
  })

  it('sums bytes across variants and shards for one event only', async () => {
    await store.put(WEDDING, HASH_A, 'original', new Uint8Array(1000))
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(300))
    await store.put(WEDDING, HASH_B, 'thumb', new Uint8Array(50))
    await store.put(GALA, HASH_A, 'original', new Uint8Array(99_999))

    expect(await store.usedBytes(WEDDING)).toBe(1350)
    expect(await store.usedBytes(GALA)).toBe(99_999)
  })

  it('reports zero bytes for an event with no media', async () => {
    expect(await store.usedBytes(GALA)).toBe(0)
  })

  it.each([
    ['a parent traversal', '../../../etc'],
    ['an absolute path', '/etc/passwd'],
    ['a bare dot-dot', '..'],
    ['a path separator', 'a/b'],
    ['a backslash', 'a\\b'],
    ['an empty string', ''],
  ])('refuses %s as an event id', async (_label, unsafe) => {
    // Server-generated UUIDs mean this cannot happen in practice. It is asserted
    // because "cannot happen in practice" is exactly what was said about 1.0's
    // filename regex, and the consequence here is reading outside the media root.
    const eventId = unsafe as EventId

    await expect(store.put(eventId, HASH_A, 'display', new Uint8Array([1]))).rejects.toThrow(
      /unsafe event id|outside its root/,
    )
    await expect(store.usedBytes(eventId)).rejects.toThrow(/unsafe event id|outside its root/)
  })

  it('writes nothing outside its root', async () => {
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))

    const entries = await readdir(root)
    expect(entries).toEqual([WEDDING])
  })

  it('stores the exact bytes it was given, byte for byte', async () => {
    // A binary round-trip, because a text-mode write on Windows would corrupt a JPEG
    // by translating 0x0A.
    const bytes = new Uint8Array([0x00, 0x0a, 0x0d, 0x1a, 0xff, 0xd8, 0xff])
    await store.put(WEDDING, HASH_A, 'original', bytes)

    const shard = HASH_A.value.slice(0, 2)
    const onDisk = await readFile(
      join(root, WEDDING, 'original', shard, `${HASH_A.value}.jpg`),
    )
    expect(new Uint8Array(onDisk)).toEqual(bytes)
  })

  it('writes the same bytes twice as one object, not two', async () => {
    // Content addressing is what makes a retry after a dropped upload free: the second
    // write of identical bytes must land on the same address, not add a second file
    // that counts against the event's quota.
    const bytes = new Uint8Array([4, 2])

    await store.put(WEDDING, HASH_A, 'display', bytes)
    await store.put(WEDDING, HASH_A, 'display', bytes)

    const shard = HASH_A.value.slice(0, 2)
    expect(await readdir(join(root, WEDDING, 'display', shard))).toEqual([`${HASH_A.value}.jpg`])
    expect(await store.usedBytes(WEDDING)).toBe(2)
  })

  it('removes its temporary file when the rename into place fails', async () => {
    // A directory standing where the object belongs makes the rename fail *after* the
    // temporary file has been written. A leaked `.tmp` is counted by `usedBytes`, so it
    // would eat the event's quota with bytes no photo refers to.
    await mkdir(objectPath(root, WEDDING, 'display', HASH_A), { recursive: true })

    await expect(store.put(WEDDING, HASH_A, 'display', new Uint8Array([1]))).rejects.toThrow()

    const shard = HASH_A.value.slice(0, 2)
    const files = await readdir(join(root, WEDDING, 'display', shard))
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('refuses a content hash that is not a 64-character hex digest', async () => {
    // A traversal control. `ContentHash.create` cannot produce this value, so the cast
    // stands in for a caller that skipped it — which is exactly the assumption 1.0 made
    // about its filename regex. An unchecked hash in a path is the difference between a
    // broken image and writing over `/etc/passwd`.
    const hostile = { value: '../../../../etc/passwd' } as unknown as ContentHash

    await expect(store.put(WEDDING, hostile, 'display', new Uint8Array([1]))).rejects.toThrow(
      /unsafe content hash/,
    )
  })

  it('refuses a path that would climb out of the media root', async () => {
    // The variant is a closed union in TypeScript, so this too is defence in depth:
    // the final `startsWith` check is what guarantees no combination of segments can
    // address a file outside the root, whatever a future caller passes.
    const hostile = '../../..' as MediaVariant

    await expect(store.put(WEDDING, HASH_A, hostile, new Uint8Array([1]))).rejects.toThrow(
      /outside its root/,
    )
    expect(await readdir(root)).toEqual([])
  })

  it('surfaces a filesystem failure instead of reporting zero used bytes', async () => {
    // Zero is the honest answer for an event that stored nothing, so swallowing an
    // unexpected failure here would silently disable the byte quota and let one event
    // fill the disk. A file where the event directory belongs makes the listing fail.
    await writeFile(join(root, GALA), new Uint8Array([1]))

    await expect(store.usedBytes(GALA)).rejects.toThrow()
  })

  it('surfaces a filesystem failure instead of reporting a stored photo as absent', async () => {
    // `null` means "no such photo" and the HTTP layer turns it into a 404. A photo whose
    // bytes are unreadable is a different answer and must not be reported as missing.
    await mkdir(objectPath(root, WEDDING, 'display', HASH_A), { recursive: true })

    await expect(store.read(WEDDING, HASH_A, 'display')).rejects.toThrow()
  })

  /**
   * A junction pointing at itself is the one filesystem failure a test can create on
   * every platform without touching permissions: reading it fails with `ELOOP`. It
   * stands in for the real unreadable-file cases — a failing disk (`EIO`), a media root
   * whose permissions changed (`EACCES`) — all of which must be told apart from "there
   * is no such photo".
   */
  const unreadableObject = async (variant: string): Promise<void> => {
    const target = objectPath(root, WEDDING, variant, HASH_A)
    await mkdir(dirname(target), { recursive: true })
    await symlink(target, target, 'junction')
  }

  it.each([
    ['exists', async (subject: MediaStore) => subject.exists(WEDDING, HASH_A, 'display')],
    ['stat', async (subject: MediaStore) => subject.stat(WEDDING, HASH_A, 'display')],
    ['openRead', async (subject: MediaStore) => subject.openRead(WEDDING, HASH_A, 'display')],
  ])('%s surfaces an unreadable object instead of reporting it absent', async (_name, call) => {
    // "Absent" is the answer that produces a 404 and lets the reconciliation job decide
    // a row has no file. An object that exists but cannot be read is a different fact
    // and has to travel as a failure.
    await unreadableObject('display')

    await expect(call(store)).rejects.toThrow()
  })

  it('skips a file that vanished between the listing and the stat', async () => {
    // A delete racing the reconciliation job is expected, and the sum is a
    // reconciliation figure rather than an accounting record — so a file that is gone by
    // the time it is measured must not fail the whole count.
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(100))
    const shard = HASH_A.value.slice(0, 2)
    const inShard = join(root, WEDDING, 'display', shard)
    await symlink(join(inShard, 'already-deleted.jpg'), join(inShard, 'vanished.jpg'), 'junction')

    expect(await store.usedBytes(WEDDING)).toBe(100)
  })

  it('does not report a partial total when a listed file cannot be measured', async () => {
    // The other side of the rule above: a file that is gone is skipped, but a file that
    // cannot be read is not evidence of anything. Under-reporting here hands the event
    // quota back to a disk that is already full.
    const eventDirectory = join(root, GALA)
    await mkdir(eventDirectory, { recursive: true })
    await symlink(join(eventDirectory, 'a'), join(eventDirectory, 'a'), 'junction')

    await expect(store.usedBytes(GALA)).rejects.toThrow()
  })

  it('surfaces a filesystem failure instead of reporting a delete as done', async () => {
    // Deleting a variant that was never generated is a success by contract; "the file
    // is still there" is not. Reporting it as done would drop the row and leave the
    // bytes on disk for ever.
    await mkdir(objectPath(root, WEDDING, 'display', HASH_A), { recursive: true })

    await expect(store.delete(WEDDING, HASH_A)).rejects.toThrow()
  })
})
