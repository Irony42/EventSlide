import { useState } from 'react'
import { Async } from '../../design-system/components/Async'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { useToast } from '../../design-system/components/useToast'
import { useApi } from '../../lib/useApi'
import { useTranslations } from '../../lib/i18n/useTranslations'
import type { ReelDto } from '../../lib/api/dto'
import { useBestOf, usePreselectHighlights, useRequestReel } from './hooks/useBestOf'
import styles from './BestOfPanel.module.css'

/** How many photographs "pre-select the most liked" stars. A product default, shown in the answer. */
const PRESELECT_LIMIT = 20

/** The server's own reason of a failed montage, in words; the generic sentence for a code unknown here. */
const failureMessage = (
  reel: ReelDto,
  errors: Readonly<Record<string, string>>,
  fallback: string,
): string => (reel.failureCode === undefined ? undefined : errors[reel.failureCode]) ?? fallback

export interface BestOfPanelProps {
  readonly slug: string
  /** Whether the event can still be moderated: starring is a moderation decision. */
  readonly canStar: boolean
}

/**
 * The host's best-of (spec 08): the favourites' count, the pre-selection from the reactions,
 * the ZIP of the favourites (step 1), and the highlight video made from them (step 2).
 *
 * Renders nothing for a server that does not know the routes. The count and the montage's state
 * are the server's: the panel states no rule, and the ZIP button is disabled at zero because the
 * server would answer `highlight.empty` to it. The montage is read again every few seconds while
 * it is queued or running (`useBestOf`), and its state is announced without moving focus.
 */
export function BestOfPanel({ slug, canStar }: BestOfPanelProps) {
  const t = useTranslations()
  const api = useApi()
  const toast = useToast()
  const best = useBestOf(slug)
  const preselect = usePreselectHighlights()
  const requestReel = useRequestReel()
  const [announcement, setAnnouncement] = useState('')
  // A server without the transcoder answers 500 `reel.transcoderUnavailable`: step 2 goes away.
  const [noTranscoder, setNoTranscoder] = useState(false)

  if (best.data === 'unsupported') return null
  const count = best.data?.count ?? 0
  const reel = best.data?.reel ?? null
  const making = reel?.status === 'queued' || reel?.status === 'running'

  const runPreselect = () => {
    void preselect.run('preselect', slug, PRESELECT_LIMIT).then((result) => {
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      setAnnouncement(
        result.value.added === 0
          ? t.admin.bestOfPreselectNothing
          : t.admin.bestOfPreselected(PRESELECT_LIMIT),
      )
      best.reload()
    })
  }

  const runReel = () => {
    void requestReel.run('reel', slug).then((result) => {
      if (result.ok) {
        setAnnouncement(t.admin.reelAsked)
      } else if (result.message === t.errors['reel.transcoderUnavailable']) {
        setNoTranscoder(true)
      } else {
        // `reel.alreadyRunning` lands here too: the toast says so and the read below shows it.
        toast.show(result.message, { tone: 'danger' })
      }
      best.reload()
    })
  }

  const reelStatus = (): string | null => {
    if (reel === null) return null
    switch (reel.status) {
      case 'queued':
        return t.admin.reelQueued
      case 'running':
        return t.admin.reelRunning
      case 'failed':
        return failureMessage(reel, t.errors, t.admin.reelFailed)
      case 'stale':
        return t.admin.reelStale
      case 'done':
        return t.admin.reelReady(reel.photoCount)
    }
  }

  return (
    <Card as="h2" title={t.admin.bestOf} subtitle={t.admin.bestOfHint}>
      <Async state={best} as="h3">
        {() => (
          <p className={count === 0 ? styles['none'] : styles['count']}>
            {count === 0 ? t.admin.bestOfNone : t.admin.bestOfCount(count)}
          </p>
        )}
      </Async>

      <div className={styles['actions']}>
        {canStar ? (
          <Button variant="secondary" loading={preselect.busy} onClick={runPreselect}>
            {t.admin.bestOfPreselect}
          </Button>
        ) : null}
        {count === 0 ? (
          <Button variant="primary" disabled>
            {t.admin.bestOfDownload}
          </Button>
        ) : (
          <a className={styles['download']} href={api.bestOfUrl(slug)} download>
            {t.admin.bestOfDownload}
          </a>
        )}
      </div>

      {noTranscoder || count === 0 || !canStar || best.data === null ? null : (
        <section className={styles['reel']} aria-labelledby="reel-title">
          <h3 id="reel-title">{t.admin.reelTitle}</h3>
          <p className={styles['none']}>{t.admin.reelHint}</p>
          <p role="status" aria-live="polite">
            {reelStatus()}
          </p>
          {reel?.status === 'done' ? (
            <video className={styles['player']} controls preload="metadata" src={api.reelUrl(slug)}>
              {t.admin.reelPlayer}
            </video>
          ) : null}
          <div className={styles['actions']}>
            <Button
              variant="secondary"
              loading={requestReel.busy || making}
              disabled={making}
              onClick={runReel}
            >
              {reel === null ? t.admin.reelCreate : t.admin.reelRedo}
            </Button>
            {reel?.status === 'done' ? (
              <a className={styles['download']} href={api.reelUrl(slug)} download>
                {t.admin.reelDownload}
              </a>
            ) : null}
          </div>
        </section>
      )}

      {/* The answer of the pre-selection, announced without moving focus. */}
      <p className={styles['announcement']} role="status" aria-live="polite">
        {announcement}
      </p>
    </Card>
  )
}
