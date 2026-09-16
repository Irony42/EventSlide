import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The two halves of the wire contract, compared field by field.
 *
 * Every response shape is declared **twice**: once in this folder's `dto.ts` for the
 * server, and again, independently, in `web/src/lib/api/dto.ts` for the client. The
 * client asserts its declared shape onto whatever JSON arrives, so when the two
 * disagree both sides still typecheck and nothing fails until a user reads the result.
 *
 * That is not hypothetical. The server sent
 * `{id, status, thumbUrl, displayUrl, hasCaption, createdAt}` for a moderation row
 * while the client read `width`, `height`, `caption`, `authorName` and `byteSize` as
 * well. Every moderation card in a real event rendered **"par undefined"** and
 * **"undefined × undefined pixels"** — to hosts, in production, with a fully green test
 * suite behind it. It was eventually caught by an end-to-end test looking at rendered
 * French text, which is the most expensive possible place to catch a missing field.
 *
 * This test is the cheap place. It reads both declarations as source and compares them,
 * so drift fails here in milliseconds, naming the field.
 *
 * ## Why source text rather than runtime
 *
 * A runtime check would need the client's types at runtime, and TypeScript interfaces
 * are erased. Sharing one declaration is the obvious alternative and is deliberately
 * not available: `web` and `src` are separate tsconfig projects and the architecture
 * rule forbids `web` importing from `src` (see `eslint.config.mjs`). Relaxing that to
 * de-duplicate a type would trade an enforced boundary for a convenience, so the
 * duplication stays and this test carries the cost of it.
 *
 * Reading a path is not an import: nothing here couples the server's build to the web
 * app's.
 *
 * ## What this does NOT catch
 *
 * Stated plainly, because a guard whose blind spots are unknown is trusted too much:
 *
 * - **A presenter that declares a field and never populates it.** The types agree while
 *   the value is `null` or missing at runtime. That is what the ring-4 route tests and
 *   the end-to-end journeys are for — and it is exactly how the wall's hardcoded
 *   `authorName: null` survived, since the *declaration* was right all along.
 * - **Semantic drift.** `createdAt: string` on both sides says nothing about whether one
 *   means ISO-8601 and the other epoch milliseconds.
 * - **Route-level drift.** Nothing here checks that a given endpoint actually returns
 *   the DTO the client's method expects; that pairing lives in `client.ts` and
 *   `routes/*.ts`.
 */

const SERVER = join(process.cwd(), 'src/interface/http/presenters/dto.ts')
const CLIENT = join(process.cwd(), 'web/src/lib/api/dto.ts')

type Shape = ReadonlyMap<string, string>

/** Interface name -> (field name -> type text). Type aliases are skipped: only shapes. */
const declarations = (path: string): ReadonlyMap<string, Shape> => {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true)
  const found = new Map<string, Shape>()

  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue
    const fields = new Map<string, string>()
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member) || member.type === undefined) continue
      const optional = member.questionToken === undefined ? '' : '?'
      fields.set(member.name.getText(source) + optional, member.type.getText(source))
    }
    found.set(statement.name.text, fields)
  }
  return found
}

const server = declarations(SERVER)
const client = declarations(CLIENT)

/**
 * Genuine renames across the boundary, which no naming convention can bridge.
 *
 * The convention otherwise is that the client drops the `Dto` suffix on response
 * envelopes (`JoinResponse` for `JoinResponseDto`) and keeps it on the item types
 * nested inside them (`WallItemDto`). Anything this map has to spell out is a place
 * where the two sides chose different words for one thing, which is worth keeping
 * short — and worth noticing, because a rename is how the moderation drift hid.
 */
const RENAMES: Readonly<Record<string, string>> = {
  // The client's moderation row is the server's queue *item*, not the server's
  // `ModerationPhotoDto` — the server has both, and they differ. Pairing these by name
  // would compare the client against a type no route on this path returns.
  ModerationPhotoDto: 'ModerationQueueItemDto',
  ModerationQueueResponse: 'ModerationQueuePageDto',
}

const serverNameFor = (clientName: string): string | null => {
  const renamed = RENAMES[clientName]
  if (renamed !== undefined) return renamed
  if (server.has(clientName)) return clientName
  if (server.has(`${clientName}Dto`)) return `${clientName}Dto`
  return null
}

/**
 * A type is comparable once the names inside it are translated to the server's.
 *
 * `readonly items: readonly ModerationPhotoDto[]` and
 * `readonly items: readonly ModerationQueueItemDto[]` describe the same bytes; the
 * difference is vocabulary, and comparing the raw text would report every envelope as
 * drifted. Whitespace goes too, so a reformat is not a failure.
 */
const normalise = (type: string): string => {
  // Explicit renames first, then the suffix convention. Dropping a trailing `Dto`
  // collapses both vocabularies onto one name, which is what makes
  // `readonly UploadOutcomeDto[]` and `readonly UploadOutcome[]` compare equal. It has
  // to work by identifier rather than by walking `client.keys()`, because the client
  // declares several of these as union *aliases* rather than interfaces — they never
  // appear in that map, and a keys()-driven translation silently skipped them.
  const translated = type.replace(/\b[A-Z][A-Za-z]*\b/g, (identifier) =>
    (RENAMES[identifier] ?? identifier).replace(/Dto$/, ''),
  )
  return translated.replace(/\s+/g, ' ').trim()
}

/**
 * Fields the server sends that the client does not read, each with a reason.
 *
 * Not a general escape hatch: an unread field is either a missed feature or dead weight
 * on the wire, and both deserve a decision rather than silence. An entry here is that
 * decision, written down.
 */
const UNREAD_BY_CLIENT: Readonly<Record<string, readonly string[]>> = {
  // Nothing in `web/src` renders a photo's size, and the client type dropped it
  // deliberately. It stays on the server's gallery row (`ModerationPhotoDto`) because
  // `GET /events/:slug/photos` has no client consumer at all today.
  ModerationPhotoDto: ['byteSize'],

  /**
   * The clip facet (docs/ROADMAP.md 1.4), on the three rows that can now be one.
   *
   * The decision, written down as this map asks: the **server spine** of clips landed
   * first and deliberately alone — the guest, moderation and wall surfaces are a separate
   * branch — so these fields are on the wire and nothing in `web/src` reads them yet.
   * They are not dead weight: without them the client has no way to tell a clip from a
   * photograph, no URL to play, and no duration to lay out.
   *
   * Every one of these rows still renders correctly on a client that ignores them:
   * `thumbUrl` and `displayUrl` point at the clip's **poster**, so an untaught client
   * shows a still frame rather than a broken image. **This is a temporary entry** and it
   * goes when the web surfaces land.
   */
  WallItemDto: ['kind', 'videoUrl', 'durationMs'],
  GuestPhotoDto: ['kind', 'videoUrl', 'durationMs'],
  ModerationQueueItemDto: ['kind', 'videoUrl', 'durationMs'],
  // The host's switch over video, for the same reason and with the same expiry: the
  // settings form is on the web branch. The server reads it on every clip upload.
  EventSettingsDto: ['allowClips'],
}

/** Every interface the client declares that names a shape the server also sends. */
const pairs = [...client.keys()]
  .map((clientName) => ({ clientName, serverName: serverNameFor(clientName) }))
  .filter((pair): pair is { clientName: string; serverName: string } => pair.serverName !== null)

describe('the wire contract', () => {
  it('pairs every client DTO with a server one', () => {
    // A client shape with no server counterpart is either a rename this file has not
    // been told about or a type the client invented, and both mean the comparison below
    // is silently skipping it.
    const unpaired = [...client.keys()].filter((name) => serverNameFor(name) === null)

    expect(unpaired, 'client shapes with no server counterpart — add a RENAMES entry').toEqual([])
  })

  it('found shapes on both sides at all', () => {
    // If the parser drifted from the file's syntax, every assertion below would pass
    // against empty maps.
    expect(server.size).toBeGreaterThanOrEqual(20)
    expect(client.size).toBeGreaterThanOrEqual(15)
    expect(pairs.length).toBeGreaterThanOrEqual(15)
  })

  it.each(pairs)(
    'server $serverName sends every field client $clientName reads',
    ({ clientName, serverName }) => {
      // The direction that renders `undefined` to a user, and the one that shipped.
      const clientFields = client.get(clientName) as Shape
      const serverFields = server.get(serverName) as Shape

      const missing = [...clientFields.keys()].filter(
        (field) => !serverFields.has(field) && !serverFields.has(field.replace(/\?$/, '')),
      )

      expect(missing, `${clientName} reads fields ${serverName} does not send`).toEqual([])
    },
  )

  it.each(pairs)(
    'server $serverName sends nothing client $clientName ignores',
    ({ clientName, serverName }) => {
      // The cheaper direction — an ignored field renders nothing — but still drift, and
      // on a public surface an unread field is one more thing on the wire than the
      // product needs.
      const clientFields = client.get(clientName) as Shape
      const serverFields = server.get(serverName) as Shape
      const allowed = UNREAD_BY_CLIENT[serverName] ?? []

      const unread = [...serverFields.keys()]
        .map((field) => field.replace(/\?$/, ''))
        .filter((field) => !clientFields.has(field) && !clientFields.has(`${field}?`))
        .filter((field) => !allowed.includes(field))

      expect(
        unread,
        `${serverName} sends fields ${clientName} never reads — render them or drop them, or record the decision in UNREAD_BY_CLIENT`,
      ).toEqual([])
    },
  )

  it.each(pairs)(
    '$serverName and $clientName agree on field types',
    ({ clientName, serverName }) => {
      const clientFields = client.get(clientName) as Shape
      const serverFields = server.get(serverName) as Shape

      const conflicts: string[] = []
      for (const [field, clientType] of clientFields) {
        const bare = field.replace(/\?$/, '')
        const serverType = serverFields.get(field) ?? serverFields.get(bare)
        if (serverType === undefined) continue // reported by the test above
        if (normalise(serverType) !== normalise(clientType)) {
          conflicts.push(`${bare}: server \`${serverType}\` vs client \`${clientType}\``)
        }
      }

      expect(conflicts, `${serverName} and ${clientName} disagree on a field's type`).toEqual([])
    },
  )

  it('declares no server shape that nothing outside dto.ts references', () => {
    // Dead DTOs are how two near-identical moderation rows came to exist, only one of
    // which any route returned — and the client was paired against the wrong one. A
    // declaration nobody uses is a declaration nobody maintains, and CLAUDE.md §6 says
    // prefer deleting to adding.
    const sources = readdirSync(join(process.cwd(), 'src/interface/http'), {
      recursive: true,
      encoding: 'utf8',
    })
      .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('dto.ts'))
      .map((entry) => readFileSync(join(process.cwd(), 'src/interface/http', entry), 'utf8'))
      .join('\n')

    const unreferenced = [...server.keys()].filter(
      (name) => !new RegExp(`\\b${name}\\b`).test(sources),
    )

    expect(unreferenced, 'server DTOs nothing references — delete them').toEqual([])
  })
})
