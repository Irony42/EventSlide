import { describe, expect, it } from 'vitest'
import { ARCHIVE_STATES, leftWithArchive } from './archiveState'

describe('leftWithArchive', () => {
  it('is true only for an archive that was sent to the host in full', () => {
    expect(ARCHIVE_STATES.filter(leftWithArchive)).toEqual(['served'])
  })

  it('names five states, the five words an operator reads after archive=', () => {
    expect([...ARCHIVE_STATES].sort()).toEqual(['incomplete', 'none', 'sealed', 'served', 'stale'])
  })
})
