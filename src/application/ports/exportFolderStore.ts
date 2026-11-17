import type { ByteRange } from './mediaStore'

/**
 * Where the operator's copy of an album goes, **outside the media root** (spec 22, section 8):
 * `<folder>/album.zip` and `<folder>/MANIFEST.sha256`, one folder per album under a directory the
 * operator chose. Not `ExportFileStore`: that one is the box's own copy, named by the event id, and
 * lives and dies with the album; this one is handed to the operator and is no longer the box's.
 *
 * `folder` is a single path segment built by `exportFolderName`, never a path from a caller.
 */
export interface ExportFolderStore {
  /**
   * Writes the archive to a temporary file and renames it into place, so a reader never sees a
   * half-written `album.zip`. Answers the size. Stops, deletes the temporary file and rejects when
   * more than `maxBytes` were written, and when the stream rejects.
   */
  write(
    folder: string,
    bytes: AsyncIterable<Uint8Array>,
    options: { readonly maxBytes: number },
  ): Promise<number>

  /** The finished archive's size, or `null`. */
  stat(folder: string): Promise<{ readonly size: number } | null>

  /** The archive's bytes (or a range of them), or `null`. */
  openRead(folder: string, range?: ByteRange): Promise<AsyncIterable<Uint8Array> | null>

  /** `MANIFEST.sha256`, beside the archive. Written only once the archive is verified. */
  writeManifest(folder: string, text: string): Promise<void>

  /** Idempotent: the archive, its manifest and the folder when it is then empty. */
  delete(folder: string): Promise<void>
}
