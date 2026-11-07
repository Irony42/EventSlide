import { describe, expect, it } from 'vitest'
import { STATS_METRICS } from './statsMetric'

describe('STATS_METRICS', () => {
  it('names exactly the counters the after-party page knows, each once', () => {
    expect([...STATS_METRICS]).toEqual(['galleryViews', 'galleryArchiveDownloads'])
    expect(new Set(STATS_METRICS).size).toBe(STATS_METRICS.length)
  })
})
