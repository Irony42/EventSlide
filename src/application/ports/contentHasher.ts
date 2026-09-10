/**
 * SHA-256 of a byte buffer, lowercase hexadecimal.
 *
 * Behind a port for two reasons. `node:crypto` is not importable from
 * `src/application`, and — more usefully — the digest is what makes ingest idempotent,
 * so a test needs to be able to hand the use case a deterministic, inspectable hash
 * instead of asserting against a real digest it computed the same way twice.
 *
 * Synchronous on purpose: hashing a few megabytes is CPU-bound arithmetic with nothing
 * to await, and an `async` signature would only invite a caller to hash a whole batch
 * concurrently, which starves the event loop rather than helping it.
 *
 * The caller decides *what* is hashed. Ingest hashes the **rendered** display bytes,
 * never the bytes the phone sent: two phones photographing the same scene produce
 * different uploads, while the same file sent twice produces identical output from a
 * deterministic pipeline — which is the retry a guest on a dropping connection makes.
 */
export interface ContentHasher {
  sha256Hex(bytes: Uint8Array): string
}
