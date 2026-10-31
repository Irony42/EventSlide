import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The wall's slide-order rule, and the copy the browser runs.
 *
 * `src/domain/slideshow/slideOrder.ts` is the rule and holds its tests. The cursor has to
 * move in the browser, and `web/` may not import `src/domain`, so
 * `web/src/features/wall/hooks/slideOrder.ts` carries the same text below a marker line.
 * Two projectors that disagreed about which photo comes next would be the defect the rule
 * exists to prevent, so a difference between the copies is a failing test, not a review
 * comment.
 *
 * Reading a path is not an import: the architecture rule forbidding `web` to import `src`
 * stands untouched, as it does for `wallLayoutContract.test.ts`.
 */

const MARKER = /^\/\/ -+ shared body -+$/m

const bodyOf = (relative: string): readonly string[] => {
  const text = readFileSync(join(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n')
  const marker = MARKER.exec(text)
  if (marker === null) throw new Error(`${relative} has no shared-body marker line`)
  return text.slice(marker.index).split('\n')
}

describe('the slide-order rule the browser runs', () => {
  const domain = bodyOf('src/domain/slideshow/slideOrder.ts')
  const client = bodyOf('web/src/features/wall/hooks/slideOrder.ts')

  it('found a body to compare in both files', () => {
    // Every comparison below is vacuously true against two empty bodies.
    expect(domain.length).toBeGreaterThan(50)
    expect(client.length).toBeGreaterThan(50)
  })

  it('is the same text as the domain rule, line for line', () => {
    const at = domain.findIndex((line, index) => line !== client[index])
    const first = at === -1 ? null : { line: at + 1, domain: domain[at], client: client[at] }
    expect(first).toBeNull()
    expect(client).toHaveLength(domain.length)
  })
})
