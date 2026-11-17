import { describe, expect, it } from 'vitest'
import { exportFolderName } from './exportFolder'

describe('exportFolderName', () => {
  it('is the slug and the day the album is deleted, in UTC', () => {
    expect(
      exportFolderName(
        'camille-et-sacha',
        new Date('2026-12-01T23:30:00.000Z'),
        new Date('2026-11-17T08:00:00.000Z'),
      ),
    ).toBe('camille-et-sacha-2026-12-01')
  })

  it('does not change with the day of the run, so a nightly cron rewrites one folder', () => {
    const deadline = new Date('2026-12-01T00:00:00.000Z')

    expect(exportFolderName('a', deadline, new Date('2026-11-17T00:00:00.000Z'))).toBe(
      exportFolderName('a', deadline, new Date('2026-11-18T00:00:00.000Z')),
    )
  })

  it('is the day of the run when the album has no deletion date', () => {
    expect(exportFolderName('a', null, new Date('2026-11-17T08:00:00.000Z'))).toBe('a-2026-11-17')
  })
})
