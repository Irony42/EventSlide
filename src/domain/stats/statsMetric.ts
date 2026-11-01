/**
 * What the after-party counters count. The vocabulary is closed **here**, not in the table: the
 * schema cannot extend a `CHECK` without a rebuild, so a metric the domain does not name is
 * never written (spec 05).
 */
export const STATS_METRICS = ['galleryViews', 'galleryArchiveDownloads'] as const

export type StatsMetric = (typeof STATS_METRICS)[number]

export const isStatsMetric = (value: string): value is StatsMetric =>
  STATS_METRICS.some((metric) => metric === value)
