import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  NOTICE_ACKNOWLEDGEMENTS,
  NOTICE_AUDIENCES,
  NOTICE_PUBLICATIONS,
} from '../../../domain/privacy/privacyNotice'

/**
 * The privacy notice's three closed vocabularies, on both sides of the wire (roadmap §5.1).
 *
 * `dtoContract.test.ts` compares interfaces field by field and skips type aliases, so a
 * member added to one of these on the server — the shared gallery of roadmap §4.1 is the
 * audience already argued for — would reach a phone whose `NoticeAudience` has never heard
 * of it. That phone has no sentence for it, and a notice that leaves out who else sees a
 * photo tells the guest less than the truth. The copy tables are keyed by the web's own
 * union and refuse to compile when *it* grows; this is the link that makes it grow.
 *
 * Read as source, for the reason `dtoContract.test.ts` gives: `web` and `src` are separate
 * projects and the architecture forbids the import.
 */

const CLIENT = join(process.cwd(), 'web/src/lib/api/dto.ts')

/** The string literals a union type alias in the client's DTO file is made of. */
const clientUnion = (name: string): readonly string[] => {
  const source = ts.createSourceFile(
    CLIENT,
    readFileSync(CLIENT, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  )
  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== name) continue
    const members = ts.isUnionTypeNode(statement.type) ? statement.type.types : [statement.type]
    return members.map((member) => {
      if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) {
        throw new Error(`${name} has a member that is not a string literal`)
      }
      return member.literal.text
    })
  }
  throw new Error(`web/src/lib/api/dto.ts declares no type ${name}`)
}

describe('the privacy notice vocabulary', () => {
  it.each([
    ['NoticeAudience', NOTICE_AUDIENCES],
    ['NoticePublication', NOTICE_PUBLICATIONS],
    ['NoticeAcknowledgementStatus', NOTICE_ACKNOWLEDGEMENTS],
  ] as const)('the client names every %s the server can send, and no other', (name, domain) => {
    expect([...clientUnion(name)].sort()).toEqual([...domain].sort())
  })
})
