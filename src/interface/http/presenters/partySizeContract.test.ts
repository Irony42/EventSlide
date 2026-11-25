import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PARTY_SIZE_MAX, PARTY_SIZE_MIN } from '../../../domain/guestRsvps/rsvpForm'

/**
 * The web copy of the party-size bounds, held to the domain's own. The console's number field only
 * sends a size within `web/src/lib/rsvp/partySize.ts`'s bounds; if they drifted from the server's
 * the host would be refused a size the field allows, or denied one the server accepts. The module
 * has no import, so its compiled text runs on its own.
 */
const SOURCE = join(process.cwd(), 'web/src/lib/rsvp/partySize.ts')

const load = (): { PARTY_SIZE_MIN: number; PARTY_SIZE_MAX: number } => {
  const compiled = ts.transpileModule(readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, unknown> = {}
  runInNewContext(compiled, { exports, module: { exports } })
  return exports as unknown as { PARTY_SIZE_MIN: number; PARTY_SIZE_MAX: number }
}

describe('the web copy of the party-size bounds', () => {
  it('is the domain’s', () => {
    const web = load()

    expect(web.PARTY_SIZE_MIN).toBe(PARTY_SIZE_MIN)
    expect(web.PARTY_SIZE_MAX).toBe(PARTY_SIZE_MAX)
  })
})
