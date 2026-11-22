import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { useToast } from '../../../design-system/components/useToast'
import { formatDateTime } from '../../../lib/format'
import { canManageEvent } from '../../../lib/eventLifecycle'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { useServerNow } from '../../../lib/useServerNow'
import { AlbumDeletionBand } from '../AlbumDeletionBand'
import { deleteGate, deletionMoment } from '../albumDeletion'
import { DownloadTile, TileGroup } from '../components/EventTiles'
import { StorageMeter } from '../components/StorageMeter'
import { useAlbumExport } from '../hooks/useAlbumExport'
import { usePurgeEvent } from '../hooks/useEventActions'
import { PurgeEventDialog } from '../PurgeEventDialog'
import { useEventPage } from './useEventPage'
import styles from './EventSectionPage.module.css'

/**
 * The album's page (surface: the host and the moderator): the whole album in one file, the room it
 * takes, when it goes (spec 22), and, for the owner, the deletion of the event at the very bottom.
 *
 * The deletion lives here rather than on the home page because it is gated by the album: from 30
 * days before the album's date it waits for a complete archive the host has downloaded, and the
 * download is the first thing on this page. The button stays reachable while it waits, pointing at
 * the sentence that says what is missing (a disabled button would leave the tab order silently).
 */
export function EventAlbumSection() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { event, offsetMs, albumUrl } = useEventPage()
  const purge = usePurgeEvent()
  const toast = useToast()
  const navigate = useNavigate()
  const [purging, setPurging] = useState(false)
  const blockedHintId = useId()

  const nowMs = useServerNow(offsetMs)
  const purgeAt = event.purge?.at ?? null
  const moment = deletionMoment(purgeAt, nowMs, event.purge?.offboarding === true)
  const archive = useAlbumExport(event.slug, moment !== null)
  const gate = deleteGate(moment !== null, archive.data)
  const isOwner = canManageEvent(event.role)

  const confirmPurge = () => {
    const name = event.name
    void purge.run('purge', event.slug).then((result) => {
      if (!result.ok) {
        setPurging(false)
        toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(t.admin.purged(name), { tone: 'success' })
      void navigate('/admin', { replace: true })
    })
  }

  return (
    <div className={styles['stack']}>
      <Card as="h2" title={t.eventMenu.albumTitle} subtitle={t.eventMenu.albumIntro}>
        <div className={styles['stack']}>
          <TileGroup size="large">
            <DownloadTile size="large" glyph="album" href={albumUrl} hint={t.admin.downloadHint}>
              {t.admin.download}
            </DownloadTile>
          </TileGroup>
          <StorageMeter usedBytes={event.usedBytes} quotaBytes={event.quotaBytes} />
          {event.liveWindowEnd === undefined ? null : (
            <p className={styles['note']}>
              {t.clientSpace.liveWindowEnd(
                formatDateTime(event.liveWindowEnd, locale) ?? event.liveWindowEnd,
              )}
            </p>
          )}
        </div>
      </Card>

      {moment !== null && purgeAt !== null ? (
        <AlbumDeletionBand
          slug={event.slug}
          at={purgeAt}
          moment={moment}
          archive={archive}
          albumUrl={albumUrl}
          {...(event.purge === undefined ? {} : { voices: event.purge.voices })}
        />
      ) : null}

      {isOwner ? (
        <Card as="h2" title={t.eventMenu.dangerTitle} className={styles['danger']}>
          <div className={styles['actions']}>
            {gate.kind === 'open' ? (
              <Button variant="danger" onClick={() => setPurging(true)} aria-haspopup="dialog">
                {moment === null ? t.admin.purge : t.exportPurge.deleteNow}
              </Button>
            ) : (
              <>
                <Button
                  variant="danger"
                  className={styles['blocked']}
                  aria-disabled="true"
                  aria-describedby={blockedHintId}
                  onClick={(press) => press.preventDefault()}
                >
                  {t.exportPurge.deleteNow}
                </Button>
                <Button variant="secondary" onClick={() => setPurging(true)} aria-haspopup="dialog">
                  {t.exportPurge.deleteWithout}
                </Button>
                <p id={blockedHintId} className={styles['blockedHint']}>
                  {gate.because === 'needsComplete'
                    ? t.exportPurge.needsComplete
                    : gate.because === 'needsDownload'
                      ? t.exportPurge.needsDownload
                      : t.exportPurge.needsArchive}
                </p>
              </>
            )}
          </div>
        </Card>
      ) : null}

      <PurgeEventDialog
        open={purging}
        slug={event.slug}
        eventName={event.name}
        busy={purge.busy}
        confirmWith={gate.kind === 'word' ? 'word' : 'address'}
        onConfirm={confirmPurge}
        onCancel={() => setPurging(false)}
      />
    </div>
  )
}
