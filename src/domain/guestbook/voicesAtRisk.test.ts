import { describe, expect, it } from 'vitest'
import {
  NO_VOICES_AT_RISK,
  VOICE_WARNING_DAYS,
  voicesAtRisk,
  type VoiceAtRiskInput,
} from './voicesAtRisk'

const recordings = (...statuses: VoiceAtRiskInput['recordings'][number]['status'][]) =>
  statuses.map((status) => ({ status }))

const MIXED = recordings(
  'published',
  'published',
  'hidden',
  'pending',
  'pending',
  'pending',
  'rejected',
)

describe('voicesAtRisk', () => {
  it('counts the recordings still secret that the album would carry, and those waiting for a decision', () => {
    expect(voicesAtRisk({ daysLeft: 5, recordings: MIXED, secretLifted: false })).toEqual({
      secret: 3,
      pending: 3,
    })
  })

  it('counts no secret once the secret is lifted, and still the ones waiting', () => {
    expect(voicesAtRisk({ daysLeft: 5, recordings: MIXED, secretLifted: true })).toEqual({
      secret: 0,
      pending: 3,
    })
  })

  it('says nothing a week and a day before the date, and starts at exactly a week', () => {
    const at = (daysLeft: number) =>
      voicesAtRisk({ daysLeft, recordings: MIXED, secretLifted: false })

    expect(VOICE_WARNING_DAYS).toBe(7)
    expect(at(VOICE_WARNING_DAYS + 1)).toEqual(NO_VOICES_AT_RISK)
    expect(at(VOICE_WARNING_DAYS)).toEqual({ secret: 3, pending: 3 })
    expect(at(1)).toEqual({ secret: 3, pending: 3 })
  })

  it('says nothing for an album with no date, or whose date has arrived: that is the purge’s business', () => {
    expect(voicesAtRisk({ daysLeft: null, recordings: MIXED, secretLifted: false })).toEqual(
      NO_VOICES_AT_RISK,
    )
    expect(voicesAtRisk({ daysLeft: 0, recordings: MIXED, secretLifted: false })).toEqual(
      NO_VOICES_AT_RISK,
    )
  })

  it('says nothing when there are no recordings', () => {
    expect(voicesAtRisk({ daysLeft: 3, recordings: [], secretLifted: false })).toEqual(
      NO_VOICES_AT_RISK,
    )
  })

  it('does not count a refused recording in either: it was turned down on purpose', () => {
    expect(
      voicesAtRisk({ daysLeft: 3, recordings: recordings('rejected'), secretLifted: false }),
    ).toEqual(NO_VOICES_AT_RISK)
  })
})
