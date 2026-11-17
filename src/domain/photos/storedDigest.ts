import type { MediaKind } from './mediaKind'
import type { ServedVariant } from './mediaVariant'

/**
 * Whether the digest a row stores is the SHA-256 of **this variant's bytes**, so that a file read
 * back from the disk can be held against it.
 *
 * It is not true of every file, and spec 22 first assumed it was ("the name of a file is its
 * digest"). A photograph's `content_hash` is taken over its **display** rendition at ingest
 * (`uploadPhotos`), and its `original` and `thumb` are stored under the same name with other
 * bytes: hashing the original and comparing it with the name would condemn every healthy photograph.
 * A clip's `video` and `poster` are each hashed over their own bytes (`transcodeNextClip`), so
 * both can be checked.
 *
 * The host's ZIP asks this before it trusts a name: it verifies what the digest vouches for and
 * says nothing about the rest, rather than raising an alarm that is always on.
 */
export const digestVouchesForVariant = (kind: MediaKind, variant: ServedVariant): boolean =>
  kind === 'clip' || variant === 'display'
