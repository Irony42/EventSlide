import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VARIANT_SPECS } from '../../../application/usecases/photos/uploadPhotos'
import { classifyClipFailure } from '../../../domain/clips/clipFailure'
import { GALLERY_GRANT_TTL_MS } from '../../../domain/gallery/galleryMedia'
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

/**
 * Server values the browser copies, read from the browser's source (ARCH-03 / WEBGUEST-10).
 *
 * A web module that is not exported, or whose imports need a browser, cannot be loaded by path the
 * way `slugify.ts` is, so the value is read off the declaration: `const NAME = 36 * 60 * 60 * 1000`
 * is a product of numbers, and a declaration that stops being one fails here rather than passing
 * quietly. The server side is imported where it is exported and read the same way where it is not
 * (the guest cookie's lifetime lives inside `publicRoutes.ts`).
 */
const numberDeclaredIn = (relative: string, name: string): number => {
  const source = readFileSync(join(root, relative), 'utf8')
  const declaration = new RegExp(
    String.raw`const ${name}\s*(?::\s*number\s*)?=\s*([\d_]+(?:\s*\*\s*[\d_]+)*)\s*$`,
    'm',
  )
  const product = declaration.exec(source)?.[1]
  if (product === undefined) {
    throw new Error(`${relative} no longer declares ${name} as a product of numbers`)
  }
  return product
    .split('*')
    .map((factor) => Number(factor.trim().replaceAll('_', '')))
    .reduce((left, right) => left * right, 1)
}

describe('the lifetimes the web app counts on', () => {
  it('remembers an event for exactly as long as the guest cookie lives', () => {
    // A web copy longer than the cookie lists an event that no longer opens (the device is
    // unknown to the server by then); a shorter one forgets a guest the party still has.
    const cookie = numberDeclaredIn(
      'src/interface/http/routes/publicRoutes.ts',
      'GUEST_COOKIE_MAX_AGE_MS',
    )
    const remembered = numberDeclaredIn('web/src/lib/guestSession.ts', 'REMEMBERED_FOR_MS')

    expect(remembered).toBe(cookie)
  })

  it('refreshes the gallery before its signed URLs expire, with a margin for a slow network', () => {
    // A signed media URL is good for GALLERY_GRANT_TTL_MS. A refresh later than that leaves
    // every image on screen a 404 that reads as "this album was revoked".
    const refresh = numberDeclaredIn(
      'web/src/features/gallery/hooks/useGallery.ts',
      'GALLERY_REFRESH_MS',
    )

    expect(refresh).toBeLessThan(GALLERY_GRANT_TTL_MS)
    expect(GALLERY_GRANT_TTL_MS - refresh).toBeGreaterThanOrEqual(5 * 60 * 1000)
  })
})

describe('the size a phone photo is shrunk to before upload', () => {
  it('is the longest edge of the display variant the server keeps', () => {
    // Larger wastes upload time on bytes the server throws away; smaller makes the wall show a
    // photo the phone had shrunk below what the server would have kept.
    const edge = numberDeclaredIn(
      'web/src/features/guest-upload/hooks/downscaleImage.ts',
      'MAX_EDGE',
    )

    expect(edge).toBe(VARIANT_SPECS.display.maxWidth)
    expect(edge).toBe(VARIANT_SPECS.display.maxHeight)
  })
})

describe('the clip refusals after which the guest is not offered another attempt', () => {
  const finalCodes = (): string[] => {
    const source = readFileSync(join(root, 'web/src/features/guest-upload/clipFile.ts'), 'utf8')
    const body = /const NEVER_ANSWERS_DIFFERENTLY[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(
      source,
    )?.[1]
    if (body === undefined)
      throw new Error('clipFile.ts no longer declares NEVER_ANSWERS_DIFFERENTLY')
    return [...body.matchAll(/'([^']+)'/g)].map(([, code]) => code ?? '')
  }

  /**
   * The one code the web withholds a retry for that the server's own queue retries: a box without
   * an encoder answers the same until somebody redeploys, and the phone has no reason to spend a
   * full upload to hear it again (`classifyClipFailure` keeps it transient so the queue drains).
   */
  const DEPLOYMENT_CODE = 'clip.transcoderUnavailable'

  it('are all codes the server still sends', () => {
    const sources = serverSources()
    const listed = finalCodes()

    expect(listed.length).toBeGreaterThan(5)
    expect(listed.filter((code) => !sources.includes(`'${code}'`))).toEqual([])
  })

  it('are about the recording, which the server also classifies as permanent', () => {
    // A code the server retries on its own is a machine fault, and offering no button for it
    // strands a clip that would have gone through.
    const notPermanent = finalCodes().filter(
      (code) => code !== DEPLOYMENT_CODE && classifyClipFailure(code) !== 'permanent',
    )

    expect(notPermanent).toEqual([])
    expect(finalCodes()).toContain(DEPLOYMENT_CODE)
  })

  it('leave out the album verdicts, which a host clears by deleting photographs', () => {
    // The reason the server lets a failed job be re-sent at all: the same clip fits once room is made.
    for (const code of ['event.quotaExceeded', 'event.photoLimitReached']) {
      expect(serverSources()).toContain(`'${code}'`)
      expect(finalCodes()).not.toContain(code)
    }
  })
})
