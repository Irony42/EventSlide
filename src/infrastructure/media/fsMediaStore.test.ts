import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  readdir,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { closeSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import type { ReadStream } from 'node:fs'
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

  it('holds a file descriptor from the moment a stream is opened, read or not', async () => {
    /**
     * **Why a discarded stream is not free, stated where it is true.**
     *
     * `openRead` answers with a `ReadStream`, and constructing one issues the `open`
     * straight away — nothing waits for a reader. From the moment it lands, that
     * descriptor is held until the stream is destroyed or read to the end. A caller that
     * opens a stream and walks away has leaked one, which is what `mediaRoutes` did on
     * every `Range` request, every `416` and every `304`: a `<video>` seeks per request,
     * so the count climbed for as long as the evening lasted and ended at `EMFILE`, which
     * takes the wall down.
     *
     * Measured by the number the next open is handed: descriptors are allocated lowest
     * free first on every platform this runs on, so a watermark that has moved is a
     * watermark with something still holding the numbers below it.
     */
    await store.put(WEDDING, HASH_A, 'original', new Uint8Array(4_096).fill(7))
    const probe = join(root, 'probe')
    await writeFile(probe, 'x')
    const watermark = (): number => {
      const fd = openSync(probe, 'r')
      closeSync(fd)
      return fd
    }

    const before = watermark()
    const abandoned = (await Promise.all(
      Array.from({ length: 8 }, () => store.openRead(WEDDING, HASH_A, 'original')),
    )) as (ReadStream | null)[]
    // The open is asynchronous, so this waits for it rather than sleeping — and waiting
    // for `open` is itself the proof that a descriptor arrives with no read at all.
    //
    // `pending` is checked first because `once` on an event that has already fired waits
    // for ever: by the time this runs, some of the eight are open and some are not. It is
    // the documented way to ask — true exactly until the file has been opened.
    await Promise.all(
      abandoned.map(async (stream) => {
        const readStream = stream as ReadStream
        if (readStream.pending) await once(readStream, 'open')
      }),
    )

    expect(watermark()).toBeGreaterThanOrEqual(before + 8)

    // Destroying returns them, which is the other half of the rule: nothing else does.
    // Upstream the answer is to open only what will be written, and this is why.
    await Promise.all(
      abandoned.map(async (stream) => {
        const readStream = stream as ReadStream
        if (readStream.closed) return
        const closed = once(readStream, 'close')
        readStream.destroy()
        await closed
      }),
    )

    expect(watermark()).toBe(before)
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

describe('fsMediaStore: the inventory the reconciliation sweep reads', () => {
  let root: string
  let store: MediaStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-media-list-'))
    store = createFsMediaStore({ root })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists nothing for a store that has never been written to', async () => {
    expect(await store.listEvents()).toEqual([])
    expect(await store.list(WEDDING)).toEqual([])
  })

  it('names every event it is holding bytes for', async () => {
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(3))
    await store.put(GALA, HASH_B, 'thumb', new Uint8Array(4))

    expect([...(await store.listEvents())].sort()).toEqual([WEDDING, GALA].sort())
  })

  it('leaves the boot scratch directories out of the event list', async () => {
    // `.uploads` and `.scratch` live under MEDIA_ROOT because the container is read-only
    // with a tmpfs on the memory cgroup. A sweep handed them as event ids would ask the
    // database about an event that cannot exist and then delete what it found.
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(3))
    await mkdir(join(root, '.uploads'), { recursive: true })
    await mkdir(join(root, '.scratch'), { recursive: true })

    expect(await store.listEvents()).toEqual([WEDDING])
  })

  it('reports each object with its digest, variant, size and write time', async () => {
    const before = Date.now() - 1_000
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(7))

    const [object] = await store.list(WEDDING)

    expect(object?.hash.value).toBe(HASH_A.value)
    expect(object?.variant).toBe('display')
    expect(object?.byteSize).toBe(7)
    // The sweep refuses to collect anything written recently, so this field is the one
    // that decides whether a file the database does not yet name survives.
    expect(object?.modifiedAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('lists every variant of every digest, including the unservable source', async () => {
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(1))
    await store.put(WEDDING, HASH_A, 'thumb', new Uint8Array(1))
    await store.put(WEDDING, HASH_B, 'source', new Uint8Array(1))

    const objects = await store.list(WEDDING)

    expect(objects.map((object) => object.variant).sort()).toEqual(['display', 'source', 'thumb'])
  })

  it('never lists another event’s objects', async () => {
    await store.put(GALA, HASH_B, 'display', new Uint8Array(1))

    expect(await store.list(WEDDING)).toEqual([])
  })

it('reaps an abandoned .tmp on the way past, since nothing else ever would', async () => {
    // `put` writes `<target>.<uuid>.tmp` and renames. A SIGKILL between the two strands up
    // to MAX_CLIP_BYTES that no row names — invisible to the quota — and that the
    // reconciliation sweep will not touch, because a collector must never be handed a path
    // it cannot account for. Only the store knows this name is its own wreckage.
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(1))
    const shard = join(root, WEDDING, 'display', HASH_A.value.slice(0, 2))
    const stale = join(shard, `${HASH_A.value}.abandoned.tmp`)
    await writeFile(stale, 'half a photo')
    // An hour and a minute old: past the window a `put` in flight could possibly need.
    const old = new Date(Date.now() - 61 * 60 * 1000)
    await utimes(stale, old, old)

    await store.list(WEDDING)

    await expect(stat(stale)).rejects.toThrow()
  })

  it('leaves a .tmp that a put may still be writing', async () => {
    // The guard that matters: deleting a temporary file another request is writing would
    // fail that guest's upload to reclaim bytes that were never lost.
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(1))
    const shard = join(root, WEDDING, 'display', HASH_A.value.slice(0, 2))
    const fresh = join(shard, `${HASH_A.value}.in-flight.tmp`)
    await writeFile(fresh, 'being written right now')

    const objects = await store.list(WEDDING)

    expect((await stat(fresh)).size).toBeGreaterThan(0)
    // And it is still not listed: it is not an address this store could have written.
    expect(objects).toHaveLength(1)
  })


  it('refuses to name a file this store could not have written', async () => {
    // A leaked `.tmp` from an interrupted `put`, or anything an operator dropped in by
    // hand. The sweep deletes what this returns, so it must only ever return objects the
    // store owns and can address.
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(1))
    const shard = join(root, WEDDING, 'display', HASH_A.value.slice(0, 2))
    await writeFile(join(shard, `${HASH_A.value}.jpg.1234.tmp`), 'half a photo')
    await writeFile(join(shard, 'not-a-digest.jpg'), 'hand-dropped')
    // Upper-case hex parses as a digest but is not the spelling this store writes:
    // listing it under the lower-cased value would make `delete` unlink a different path
    // while reporting these bytes as reclaimed.
    await writeFile(join(shard, `${HASH_B.value.toUpperCase()}.jpg`), 'wrong case')

    const objects = await store.list(WEDDING)

    expect(objects).toHaveLength(1)
    expect(objects[0]?.hash.value).toBe(HASH_A.value)
  })
})
