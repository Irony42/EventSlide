import { describe, expect, it, vi } from 'vitest'
import { browserTimeZone, timeZoneOptions } from './timeZones'

describe('timeZoneOptions', () => {
  it('offers UTC first and the platform’s zones after it, in order', () => {
    const options = timeZoneOptions('Europe/Paris')

    expect(options[0]).toBe('UTC')
    expect(options).toContain('Europe/Paris')
    expect(options.slice(1)).toEqual([...options.slice(1)].sort((a, b) => a.localeCompare(b)))
  })

  it('always carries the zone in use, even one the platform’s list leaves out', () => {
    expect(timeZoneOptions('Mars/Olympus')).toContain('Mars/Olympus')
  })

  it('lists each zone once', () => {
    const options = timeZoneOptions('Europe/Paris')

    expect(new Set(options).size).toBe(options.length)
  })

  it('still works on a platform with no list: the zone in use and UTC', () => {
    vi.stubGlobal('Intl', { ...Intl, supportedValuesOf: undefined })
    try {
      expect(timeZoneOptions('Europe/Paris')).toEqual(['UTC', 'Europe/Paris'])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('browserTimeZone', () => {
  it('is the zone the browser reports', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Montreal',
    } as Intl.ResolvedDateTimeFormatOptions)

    expect(browserTimeZone()).toBe('America/Montreal')
    vi.restoreAllMocks()
  })
})
