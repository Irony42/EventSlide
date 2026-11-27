import { describe, expect, it } from 'vitest'
import {
  eventClosedNoticeDue,
  JOB_MAIL_MIN_DURATION_MS,
  jobWorthAMail,
  windowEndingDue,
} from './eventNotices'

const at = (iso: string): Date => new Date(iso)
const HOUR = 60 * 60 * 1000

describe('jobWorthAMail', () => {
  const REQUESTED = at('2026-12-13T10:00:00.000Z')
  const finishedAfter = (ms: number): Date => new Date(REQUESTED.getTime() + ms)

  it('names two minutes', () => {
    expect(JOB_MAIL_MIN_DURATION_MS).toBe(120_000)
  })

  it('is not worth a mail at 1:59: the host just watched it finish', () => {
    expect(jobWorthAMail(REQUESTED, finishedAfter(119_000))).toBe(false)
  })

  it('is not worth a mail at exactly two minutes, and is at 2:01', () => {
    expect(jobWorthAMail(REQUESTED, finishedAfter(120_000))).toBe(false)
    expect(jobWorthAMail(REQUESTED, finishedAfter(121_000))).toBe(true)
  })
})

describe('eventClosedNoticeDue', () => {
  const CLOSED = at('2026-12-13T22:00:00.000Z')
  const after = (ms: number): Date => new Date(CLOSED.getTime() + ms)

  it('is not due for an event never closed', () => {
    expect(eventClosedNoticeDue(null, after(20 * HOUR))).toBe(false)
  })

  it('is due from 12 hours after the first closing, and not before', () => {
    expect(eventClosedNoticeDue(CLOSED, after(12 * HOUR - 1))).toBe(false)
    expect(eventClosedNoticeDue(CLOSED, after(12 * HOUR))).toBe(true)
  })

  it('is due until 48 hours, and not from there: the moment has gone', () => {
    expect(eventClosedNoticeDue(CLOSED, after(48 * HOUR - 1))).toBe(true)
    expect(eventClosedNoticeDue(CLOSED, after(48 * HOUR))).toBe(false)
  })

  it('is not due when the album is already purged, and is while its purge is ahead', () => {
    expect(eventClosedNoticeDue(CLOSED, after(13 * HOUR), after(13 * HOUR))).toBe(false)
    expect(eventClosedNoticeDue(CLOSED, after(13 * HOUR), after(14 * HOUR))).toBe(true)
    expect(eventClosedNoticeDue(CLOSED, after(13 * HOUR), null)).toBe(true)
  })
})

describe('windowEndingDue', () => {
  const NOW = at('2026-12-13T10:00:00.000Z')
  const endIn = (ms: number): Date => new Date(NOW.getTime() + ms)

  it('is not due for an event with no live window', () => {
    expect(windowEndingDue(null, null, NOW)).toBe(false)
  })

  it('is due when the window ends within 24 hours, and not at 24 hours and one millisecond', () => {
    expect(windowEndingDue(endIn(24 * HOUR), null, NOW)).toBe(true)
    expect(windowEndingDue(endIn(24 * HOUR + 1), null, NOW)).toBe(false)
    expect(windowEndingDue(endIn(1), null, NOW)).toBe(true)
  })

  it('is not due once the window has ended', () => {
    expect(windowEndingDue(endIn(0), null, NOW)).toBe(false)
    expect(windowEndingDue(endIn(-HOUR), null, NOW)).toBe(false)
  })

  it('is not due when a scheduled closing falls before the end of the window', () => {
    expect(windowEndingDue(endIn(10 * HOUR), endIn(5 * HOUR), NOW)).toBe(false)
  })

  it('is due when the scheduled closing is at the same instant or after the window ends', () => {
    expect(windowEndingDue(endIn(10 * HOUR), endIn(10 * HOUR), NOW)).toBe(true)
    expect(windowEndingDue(endIn(10 * HOUR), endIn(30 * HOUR), NOW)).toBe(true)
  })
})
