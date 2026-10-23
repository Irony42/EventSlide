import { describe, expect, it } from 'vitest'
import { bannerLevel, contactActionOf, noticeableMeters } from './ceilingLevels'
import { anAbout, aClientLimits } from '../../testing/renderWithProviders'
import type { CeilingMeterDto } from '../../lib/api/dto'

const meter = (level: CeilingMeterDto['level']): CeilingMeterDto => ({
  kind: 'events',
  used: 1,
  max: 10,
  level,
})

describe('what the banner is made of', () => {
  it('has nothing to say below the line, so a client at 89 per cent is shown nothing', () => {
    const limits = aClientLimits({ meters: [meter('ok')] })

    expect(noticeableMeters(limits)).toEqual([])
    expect(bannerLevel(limits)).toBeNull()
  })

  it('is a warning from the warning line, and a reached limit at the ceiling', () => {
    expect(bannerLevel(aClientLimits({ meters: [meter('ok'), meter('warning')] }))).toBe('warning')
    expect(bannerLevel(aClientLimits({ meters: [meter('warning'), meter('reached')] }))).toBe(
      'reached',
    )
  })

  it('is a reached limit when the operator paused the opening of events, with no meter at all', () => {
    const base = aClientLimits({ meters: [] })

    expect(bannerLevel({ ...base, ceilings: { ...base.ceilings, liveAllowed: false } })).toBe(
      'reached',
    )
  })

  it('keeps the meters at or past the line and drops the others', () => {
    const limits = aClientLimits({ meters: [meter('ok'), meter('warning'), meter('reached')] })

    expect(noticeableMeters(limits).map((item) => item.level)).toEqual(['warning', 'reached'])
  })
})

describe('contactActionOf', () => {
  it('is a mailto: link to the address the operator published', () => {
    const about = anAbout({ operator: { name: 'Pierre', contactEmail: 'ops@example.org' } })

    expect(contactActionOf(about)).toEqual({ href: 'mailto:ops@example.org' })
  })

  it('is nothing when the operator named themselves with no address, or nobody', () => {
    expect(contactActionOf(anAbout({ operator: { name: 'Pierre' } }))).toBeNull()
    expect(contactActionOf(anAbout())).toBeNull()
  })
})
