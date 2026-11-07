/**
 * The files the HTTP layer's multipart parser has already written to disk, and nothing else.
 *
 * A clip streams to `MEDIA_ROOT/.uploads` while it arrives (so a dozen slow phones are not a
 * dozen buffers on the heap); this port is how the route then reads that file once and deletes
 * it. A port rather than `node:fs` in the route, for the usual two reasons: `src/interface/http`
 * may not import `node:fs` (lint forbids it), and the fs calls become one adapter with one test.
 *
 * It is not a general file store: it takes a path multer chose, never one a client sent.
 */
export interface StagedUploadStore {
  /**
   * The whole file as bytes, **viewed rather than copied**: a `Uint8Array` over the buffer the
   * read produced, so one allocation of the file's size is the floor and not two. Rejects when
   * the file cannot be read.
   */
  read(path: string): Promise<Uint8Array>

  /**
   * Deletes the file. A file that is already gone is not an error (it is the second of two
   * cleanups, the early one and the `finally`); any other failure rejects.
   */
  remove(path: string): Promise<void>
}
