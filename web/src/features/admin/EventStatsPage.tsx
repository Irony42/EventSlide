import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { Badge } from '../../design-system/components/Badge'
import { Card } from '../../design-system/components/Card'
import { EmptyState } from '../../design-system/components/EmptyState'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { Progress } from '../../design-system/components/Progress'
import { VisuallyHidden } from '../../design-system/components/VisuallyHidden'
import type { EventStatsResponse, ReactionKind } from '../../lib/api/dto'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { useEventStats } from './hooks/useEventStats'
import { groupByLocalHour, type LocalHour } from './lib/uploadsByHour'
import { truncateName } from './lib/truncateName'
import { uploadPeak } from './lib/uploadPeak'
import styles from './EventStatsPage.module.css'

/**
 * "How did the evening go?" Surface: the host and the moderators, on a laptop or a phone.
 *
 * Nothing here is computed from a counter: the server derives every figure from the album, so
 * an erased guest or a deleted photograph is gone on the next read. The bars regroup the
 * server's 15-minute UTC slots into the reader's own hours, and the peak is read off those same
 * bars. Guests' first names are content: shown as written, cut for display, never translated.
 */

const KINDS: readonly ReactionKind[] = ['love', 'laugh', 'wow', 'cheers', 'clap']

type BarStyle = CSSProperties & { readonly '--bar-share': string }

/** The hour as the reader's clock writes it, in the language of the page. */
const hourLabel = (hour: LocalHour, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(hour.start))

function Timeline({ stats }: { readonly stats: EventStatsResponse }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const hours = groupByLocalHour(stats.uploads.byQuarter)
  const peak = uploadPeak(hours)
  const tallest = Math.max(1, ...hours.map((hour) => hour.count))

  return (
    <Card as="h2" title={t.admin.stats.timelineTitle}>
      {peak === null ? (
        <p className={styles['muted']}>{t.admin.stats.timelineEmpty}</p>
      ) : (
        <>
          <p className={styles['peak']}>
            {t.admin.stats.peak(hourLabel(peak, locale), peak.count)}
          </p>
          {/* The picture is for the eyes; the table below is what a screen reader reads. */}
          <div className={styles['chart']} aria-hidden="true">
            <ol className={styles['bars']}>
              {hours.map((hour) => {
                const barStyle: BarStyle = { '--bar-share': String(hour.count / tallest) }
                return (
                  <li key={hour.start} className={styles['bar']}>
                    <span className={styles['barCount']}>{hour.count}</span>
                    <span className={styles['barFill']} style={barStyle} />
                    <span className={styles['barHour']}>{hourLabel(hour, locale)}</span>
                  </li>
                )
              })}
            </ol>
          </div>
          <VisuallyHidden as="div">
            <table>
              <caption>{t.admin.stats.timelineCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.admin.stats.hourColumn}</th>
                  <th scope="col">{t.admin.stats.uploadsColumn}</th>
                </tr>
              </thead>
              <tbody>
                {hours.map((hour) => (
                  <tr key={hour.start}>
                    <th scope="row">{hourLabel(hour, locale)}</th>
                    <td>{hour.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </VisuallyHidden>
        </>
      )}
    </Card>
  )
}

function Figures({ stats }: { readonly stats: EventStatsResponse }) {
  const t = useTranslations()
  return (
    <section className={styles['figures']} aria-label={t.admin.stats.title}>
      <p className={styles['figure']} aria-live="polite">
        {t.admin.stats.figureUploads(stats.uploads.total)}
      </p>
      <p className={styles['figure']}>{t.admin.stats.figureGuests(stats.guests.joined)}</p>
      <p className={styles['figure']}>{t.admin.stats.figureHere(stats.guests.activeNow)}</p>
      <p className={styles['figure']}>{t.admin.stats.figurePending(stats.photos.pending)}</p>
    </section>
  )
}

/** The first day measured, as the reader's calendar writes it. The day is a UTC date, shown as that date. */
const dayLabel = (day: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00.000Z`),
  )

function AfterTheParty({ stats }: { readonly stats: EventStatsResponse }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const text = t.admin.stats
  const { engagement } = stats

  return (
    <Card as="h2" title={text.engagementTitle}>
      {engagement === null ? (
        <p className={styles['muted']}>{text.engagementNone}</p>
      ) : (
        <>
          <ul className={styles['rows']}>
            <li>{text.albumOpens(engagement.galleryViews)}</li>
            <li>{text.zipLaunches(engagement.galleryArchiveDownloads)}</li>
          </ul>
          <p className={styles['muted']}>
            {text.measuredSince(dayLabel(engagement.since, locale))}
          </p>
        </>
      )}
      <p className={styles['muted']}>{text.engagementNote}</p>
    </Card>
  )
}

function Content({ stats }: { readonly stats: EventStatsResponse }) {
  const t = useTranslations()
  const { photos, guests, reactions } = stats
  const text = t.admin.stats

  return (
    <>
      <Figures stats={stats} />
      <Timeline stats={stats} />

      <Card as="h2" title={text.statusTitle}>
        <ul className={styles['rows']}>
          <li>
            <Badge tone="success">{text.statusPublished}</Badge> {photos.published}
          </li>
          <li>
            <Badge tone="warning">{text.statusPending}</Badge> {photos.pending}
          </li>
          <li>
            <Badge tone="danger">{text.statusRejected}</Badge> {photos.rejected}
          </li>
          <li>
            <Badge tone="neutral">{text.statusHidden}</Badge> {photos.hidden}
          </li>
        </ul>
        <Progress label={text.publishedShare} value={photos.published} max={stats.uploads.total} />
      </Card>

      <Card as="h2" title={text.guestsTitle}>
        <dl className={styles['facts']}>
          <div>
            <dt>{text.guestsJoined}</dt>
            <dd>{guests.joined}</dd>
          </div>
          <div>
            <dt>{text.guestsContributors}</dt>
            <dd>{guests.contributors}</dd>
          </div>
          <div>
            <dt>{text.guestsRevoked}</dt>
            <dd>{guests.revoked}</dd>
          </div>
        </dl>
      </Card>

      <Card as="h2" title={text.reactionsTitle} subtitle={text.reactionsTotal(reactions.total)}>
        <ul className={styles['rows']}>
          {KINDS.map((kind) => (
            <li key={kind}>
              {t.upload.reactionKinds[kind]} {reactions.byKind[kind]}
            </li>
          ))}
        </ul>
      </Card>

      <Card as="h2" title={text.topTitle}>
        {stats.topContributors.length === 0 && stats.anonymousContributors.guests === 0 ? (
          <p className={styles['muted']}>{text.topEmpty}</p>
        ) : (
          <>
            <ol className={styles['top']}>
              {stats.topContributors.map((line, index) => (
                // A first name is not unique, so the rank is part of the key.
                <li key={`${index}-${line.displayName}`}>
                  <span className={styles['name']} title={line.displayName}>
                    {truncateName(line.displayName)}
                  </span>
                  <span className={styles['muted']}>
                    {text.topLine(line.photos, line.reactions)}
                  </span>
                </li>
              ))}
            </ol>
            {stats.anonymousContributors.guests === 0 ? null : (
              <p className={styles['muted']}>
                {text.anonymous(
                  stats.anonymousContributors.guests,
                  stats.anonymousContributors.photos,
                )}
              </p>
            )}
          </>
        )}
      </Card>

      <AfterTheParty stats={stats} />

      <p className={styles['muted']}>{text.retention}</p>
    </>
  )
}

export function EventStatsPage() {
  const t = useTranslations()
  const { slug = '' } = useParams()
  const { data: stats, loading, error, reload } = useEventStats(slug)

  const trail = <HostBreadcrumb slug={slug} page="stats" eventName={null} />

  if (stats === null) {
    return (
      <div className={styles['page']}>
        {trail}
        {error !== null ? (
          <LoadFailure message={error} onRetry={reload} as="h1" />
        ) : loading ? (
          <Pending label={t.admin.stats.loading} />
        ) : null}
      </div>
    )
  }

  const nothingYet = stats.uploads.total === 0 && stats.guests.joined === 0

  return (
    <div className={styles['page']}>
      {trail}
      <h1 className={styles['title']}>{t.admin.stats.title}</h1>
      {nothingYet ? (
        <EmptyState
          title={t.admin.stats.title}
          description={t.admin.stats.empty}
          as="h2"
          action={
            <Link className={styles['link']} to={`/admin/events/${slug}`}>
              {t.admin.stats.emptyAction}
            </Link>
          }
        />
      ) : (
        <Content stats={stats} />
      )}
    </div>
  )
}
