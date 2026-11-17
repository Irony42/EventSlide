/**
 * The folder the operator's copy of an album goes in (spec 22, section 8): `<slug>-<date>`, the date
 * being the day the box will delete the album (UTC), or the day of the export when the album has no
 * date. **Named by the deletion date, not by the day of the run**, so a cron that runs every night
 * rewrites one folder per album instead of leaving a new multi-gigabyte copy each time.
 *
 * The slug is already a safe path segment (`Slug`); nothing the host typed reaches the file system.
 */
export const exportFolderName = (slug: string, deadline: Date | null, now: Date): string =>
  `${slug}-${(deadline ?? now).toISOString().slice(0, 10)}`

/** The two files of the operator's copy. */
export const EXPORT_FOLDER_ARCHIVE = 'album.zip'
export const EXPORT_FOLDER_MANIFEST = 'MANIFEST.sha256'
