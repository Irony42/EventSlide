import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AUDIT_RETENTION_DEFAULT_DAYS } from '../src/domain/audit/auditRetention'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (name: string): string => readFileSync(join(ROOT, name), 'utf8')

/**
 * The default of `AUDIT_RETENTION_DAYS` is promised to people by the privacy policy a box
 * publishes (one year), and a Docker install reads it from `compose.yaml` before the code's own
 * default is ever consulted. Three places state it; they must agree.
 */
describe('the default of AUDIT_RETENTION_DAYS', () => {
  it('is the same in compose.yaml and in the code', () => {
    const match = /AUDIT_RETENTION_DAYS: \$\{AUDIT_RETENTION_DAYS:-(\d+)\}/.exec(
      read('compose.yaml'),
    )

    expect(Number(match?.[1])).toBe(AUDIT_RETENTION_DEFAULT_DAYS)
  })

  it('is the value .env.example sets', () => {
    const match = /^AUDIT_RETENTION_DAYS=(\d+)$/m.exec(read('.env.example'))

    expect(Number(match?.[1])).toBe(AUDIT_RETENTION_DEFAULT_DAYS)
  })
})
