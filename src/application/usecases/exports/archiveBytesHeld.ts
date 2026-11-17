import type { AlbumExportRepository } from '../../ports/albumExportRepository'
import type { ExportFileStore } from '../../ports/exportFileStore'

/**
 * What the archives already weigh on this box: the sealed ones (the rows know their size) and the one
 * being written (it has no sealed size yet, but its temporary file weighs what it has written so far).
 * What `EXPORT_MAX_TOTAL_BYTES` is judged against, by the request and by the build, the same way.
 */
export const archiveBytesHeld = async (
  exports: Pick<AlbumExportRepository, 'sealedBytes'>,
  exportFiles: Pick<ExportFileStore, 'listTemporary'>,
): Promise<number> => {
  const writing = (await exportFiles.listTemporary()).reduce((sum, file) => sum + file.size, 0)
  return (await exports.sealedBytes()) + writing
}
