import { useId } from 'react'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { useToast } from '../../design-system/components/useToast'
import { formatBytes, formatDateTime, formatDay } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import type { LoaderState } from '../../lib/useLoader'
import { useApi } from '../../lib/useApi'
import {
  archiveView,
  type AlbumExportRead,
  type ArchiveView,
  type DeletionMoment,
} from './albumDeletion'
import { useArchiveDownload } from './hooks/useArchiveDownload'
import { useRequestAlbumExport } from './hooks/useAlbumExport'
import styles from './AlbumDeletionBand.module.css'

export interface AlbumDeletionBandProps {
  readonly slug: string
  /** When the album will be deleted, an ISO-8601 instant: the page counts it against the server's clock. */
  readonly at: string
  readonly moment: DeletionMoment
  /** The archive's read, held by the page: the early-deletion button reads the same one. */
  readonly archive: LoaderState<AlbumExportRead>
  /** The streamed ZIP's address, unchanged. */
  readonly albumUrl: string
}

/**
 * The band under the event's status card that says when the album will be deleted (spec 22) and what
 * to do before: take the album, or have the server prepare a verified archive.
 *
 * It is on the page from 30 days before the date, always (the host is told whether or not an e-mail
 * reached them), and says the urgency in words, never in a colour alone. It states no rule: the
 * server decides what may be asked (`409 export.noRoom`, the daily ceiling) and its refusal is shown
 * as the sentence for its code. It says **sent**, never "received": the server sees the last byte
 * leave, not the host's disk. And it never says why a date has passed or that the operator may hold a
 * purge: a hold is invisible to the host, who may be the person concerned.
 */
export function AlbumDeletionBand({ slug, at, moment, archive, albumUrl }: AlbumDeletionBandProps) {
  const text = useTranslations()
  const t = text.exportPurge
  const { locale } = useLocale()
  const api = useApi()
  const toast = useToast()
  const request = useRequestAlbumExport()
  const onDownload = useArchiveDownload()
  const statusId = useId()

  const view = archiveView(archive.data)
  const day = formatDay(at, locale) ?? at

  const prepare = () => {
    void request.run('request', slug).then((result) => {
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      archive.replace(result.value)
    })
  }

  const headline =
    moment.kind === 'passed'
      ? t.passed
      : moment.kind === 'today'
        ? t.deletesToday(day)
        : t.deletesOn(day, moment.days)

  const sentences = (current: ArchiveView): readonly string[] => {
    switch (current.kind) {
      case 'loading':
      case 'none':
        return []
      case 'working':
        return [t.working]
      case 'retired':
        return [t.retired]
      case 'changed':
        return [t.changed]
      case 'failed':
        return [
          current.cause === 'noRoom'
            ? t.noRoom
            : current.cause === 'tooLarge'
              ? t.tooLarge
              : t.failed,
        ]
      case 'ready': {
        const { archive: sealed } = current
        const sealedOn = formatDateTime(sealed.sealedAt ?? sealed.requestedAt, locale) ?? ''
        const until =
          sealed.expiresAt === null ? null : (formatDateTime(sealed.expiresAt, locale) ?? null)
        const lines = [
          t.ready(sealed.entries ?? 0, formatBytes(sealed.bytes ?? 0, locale), sealedOn, until),
        ]
        if (current.missing > 0) lines.push(t.incomplete(current.missing))
        if (current.sentAt !== null) {
          lines.push(t.sent(formatDateTime(current.sentAt, locale) ?? current.sentAt))
        }
        return lines
      }
    }
  }

  // The archive could not be read (a refusal, the server down) and there is no archive to show: say so
  // and offer to ask again, rather than a band that is silent and offers nothing. `none` counts, as the
  // loader starts from it while the band is not on the page yet: it is not an answer of the server's.
  const unread = (archive.data === null || archive.data === 'none') && archive.error !== null
  const lines = unread ? [archive.error ?? ''] : sentences(view)
  const hasArchive = view.kind === 'ready'

  return (
    <Card as="h2" title={t.title} className={styles['band']}>
      <p className={styles['headline']}>
        {headline}
        {moment.kind === 'passed' ? null : <> {t.downloadFirst}</>}
      </p>

      {/* Announced without moving focus: the archive finishes while the host is elsewhere. */}
      <div className={styles['status']} role="status" aria-live="polite" id={statusId}>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {view.kind === 'ready' && view.archive.sha256 !== null ? (
          <p>
            {t.digest} <code className={styles['digest']}>{view.archive.sha256}</code>
          </p>
        ) : null}
      </div>

      <div className={styles['actions']}>
        <a className={styles['link']} href={albumUrl} download onClick={onDownload}>
          {t.downloadAlbum}
        </a>
        {hasArchive ? (
          <a
            className={styles['link']}
            href={api.albumExportUrl(slug)}
            download
            onClick={onDownload}
          >
            {t.downloadArchive}
          </a>
        ) : null}
        {unread ? (
          <Button variant="secondary" loading={archive.loading} onClick={archive.reload}>
            {text.app.retry}
          </Button>
        ) : view.kind === 'loading' || view.kind === 'working' ? null : (
          <Button variant="secondary" loading={request.busy} onClick={prepare}>
            {view.kind === 'none' ? t.prepare : t.rebuild}
          </Button>
        )}
      </div>
      <p className={styles['note']}>{t.directNote}</p>
    </Card>
  )
}
