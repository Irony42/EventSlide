import { describe, expect, it } from 'vitest'
import { isStatsMetric, STATS_METRICS } from './statsMetric'

describe('isStatsMetric', () => {
  it('accepts every metric the vocabulary names', () => {
    for (const metric of STATS_METRICS) expect(isStatsMetric(metric)).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isStatsMetric('wallSeconds')).toBe(false)
    expect(isStatsMetric('')).toBe(false)
  })
})
