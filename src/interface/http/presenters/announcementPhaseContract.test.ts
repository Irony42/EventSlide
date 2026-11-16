import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The announcement phase rule, and the copy the browser runs (spec 21, rule 5).
 *
 * Same arrangement as `wallPhaseContract.test.ts`: the rule is
 * `src/domain/announcements/announcementPhase.ts`, the browser carries the same text below a
 * marker line, and a difference between the copies is a failing test, not a review comment.
 *
 * Reading a path is not an import: the architecture rule forbidding `web` to import `src`
 * stands untouched.
 */

const MARKER = /^\/\/ -+ shared body -+$/m

const bodyOf = (relative: string): readonly string[] => {
  const text = readFileSync(join(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n')
  const marker = MARKER.exec(text)
  if (marker === null) throw new Error(`${relative} has no shared-body marker line`)
  return text.slice(marker.index).split('\n')
}

describe('the announcement phase rule the browser runs', () => {
  const domain = bodyOf('src/domain/announcements/announcementPhase.ts')
  const client = bodyOf('web/src/features/wall/announcementPhase.ts')

  it('found a body to compare in both files', () => {
    // Every comparison below is vacuously true against two empty bodies.
    expect(domain.length).toBeGreaterThan(15)
    expect(client.length).toBeGreaterThan(15)
  })

  it('is the same text as the domain rule, line for line', () => {
    const at = domain.findIndex((line, index) => line !== client[index])
    const first = at === -1 ? null : { line: at + 1, domain: domain[at], client: client[at] }
    expect(first).toBeNull()
    expect(client).toHaveLength(domain.length)
  })
})
