import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { slugify as domainSlugify } from '../../../domain/shared/slug'

/**
 * Two rules the browser carries a copy of, run on the same cases as the server's own.
 *
 * Same arrangement as `wallPhaseContract.test.ts` (spec 09) and its siblings: the architecture
 * rule forbidding `web` to import `src` stands, and so does the reverse, so the browser's copy
 * is *loaded by path* here rather than imported. Both sides then answer the same table, and a
 * difference is a failing test, not a review comment.
 *
 * - **The slug.** `NewEventPage` previews `web/src/lib/slugify.ts` while the host types; the
 *   server creates the slug with `src/domain/shared/slug.ts`. Each has its own unit test, and
 *   those tests used to be the only link ("cases copied on purpose"): a rule added on one
 *   side left both green while the preview and the created slug differed.
 * - **The terminal upload codes.** `web/src/lib/offline/outboxPolicy.ts` lists the refusals
 *   after which the outbox deletes the guest's photo. A code the server renamed would turn
 *   "delete, it will never be accepted" into "retry for twelve hours", with nothing failing.
 *   Every code on the list must still be one the server can send.
 */

const root = process.cwd()

const loadWeb = async (relative: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ pathToFileURL(join(root, relative)).href)) as Record<
    string,
    unknown
  >

interface WebSlug {
  readonly slugify: (raw: string) => string
  readonly SLUG_MAX_LENGTH: number
}

const webSlug = async (): Promise<WebSlug> => {
  const module = await loadWeb('web/src/lib/slugify.ts')
  const { slugify, SLUG_MAX_LENGTH } = module
  if (typeof slugify !== 'function' || typeof SLUG_MAX_LENGTH !== 'number') {
    throw new Error('web/src/lib/slugify.ts no longer exports slugify and SLUG_MAX_LENGTH')
  }
  return { slugify: (raw) => String(slugify(raw)), SLUG_MAX_LENGTH }
}

/** Accents, runs of separators, case, the length cut, a cut inside a separator, nothing left. */
const SLUG_CASES: readonly string[] = [
  'Camille & Sacha à Lyon',
  'Fête de la Saint-Jean à Nîmes',
  'Anne   ///   Bob',
  '  -- Fête du village -- ',
  '!!! ??? ...',
  'camille-et-sacha',
  'ÉÈÊË çÇ ñÑ üÜ ÿ',
  'Œuvre & Æon',
  'ß straße',
  'Zażółć gęślą jaźń',
  '日本語のイベント 2026',
  'Mariage 💍 de Léa',
  'a'.repeat(100),
  `${'a'.repeat(63)} bravo`,
  `${'a'.repeat(62)} - - b`,
  'Ｆｕｌｌｗｉｄｔｈ １２３',
  'été (combining accents)',
  '',
]

describe('the slug the host previews and the slug the server creates', () => {
  it('answer every case alike', async () => {
    const web = await webSlug()
    const differing = SLUG_CASES.map((raw) => ({
      raw,
      domain: domainSlugify(raw),
      web: web.slugify(raw),
    })).filter((row) => row.domain !== row.web)

    expect(differing).toEqual([])
  })

  it('has a table that exercises a cut, a fold and an empty result', async () => {
    // A table of cases that all agree trivially would prove nothing.
    const web = await webSlug()
    const answers = SLUG_CASES.map((raw) => web.slugify(raw))
    expect(answers.some((answer) => answer.length === web.SLUG_MAX_LENGTH)).toBe(true)
    expect(answers).toContain('camille-sacha-a-lyon')
    expect(answers).toContain('')
  })

  it('cut at the same length', async () => {
    const web = await webSlug()
    expect(domainSlugify('a'.repeat(200))).toHaveLength(web.SLUG_MAX_LENGTH)
  })
})

const serverSources = (): string => {
  const parts: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
        parts.push(readFileSync(path, 'utf8'))
      }
    }
  }
  walk(join(root, 'src'))
  return parts.join('\n')
}

describe('the upload refusals after which the outbox deletes a photo', () => {
  it('are all codes the server still sends', async () => {
    const module = await loadWeb('web/src/lib/offline/outboxPolicy.ts')
    const codes = module['TERMINAL_CODES']
    if (!(codes instanceof Set)) throw new Error('outboxPolicy no longer exports TERMINAL_CODES')

    const listed = [...codes].map(String)
    expect(listed.length).toBeGreaterThan(10)

    const sources = serverSources()
    const unknownToServer = listed.filter(
      (code) => !sources.includes(`'${code}'`) && !sources.includes(`"${code}"`),
    )
    expect(unknownToServer).toEqual([])
  })

  it('leave out the code the server sends when its own box failed to render', async () => {
    // A full disk is not the guest's file: \image.renderUnavailable must reach the phone as a
    // refusal the outbox keeps. If the server stops sending it, or the list ever grows it, the
    // photo of every guest in the room is deleted during an outage.
    const module = await loadWeb('web/src/lib/offline/outboxPolicy.ts')
    const codes = module['TERMINAL_CODES']
    if (!(codes instanceof Set)) throw new Error('outboxPolicy no longer exports TERMINAL_CODES')

    expect(serverSources()).toContain("'image.renderUnavailable'")
    expect(codes.has('image.renderUnavailable')).toBe(false)
  })
})
