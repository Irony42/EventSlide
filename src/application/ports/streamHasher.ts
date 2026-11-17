/**
 * SHA-256 of bytes that arrive a chunk at a time, for a file too large to hold: the host's
 * album ZIP is hashed as it passes through, one chunk, never the whole file.
 *
 * A port beside `ContentHasher` and not a method on it, because that one is the whole-buffer
 * hash of ingest and many tests stand it in with an object of one function. `update` then
 * `digestHex`, once; a hasher is not reused after it has answered.
 */
/** What `start` hands out: a value with two functions, not a port of its own. */
export interface IncrementalHash {
  readonly update: (chunk: Uint8Array) => void
  /** Lowercase hex, 64 characters. */
  readonly digestHex: () => string
}

export interface StreamHasher {
  start(): IncrementalHash
}
