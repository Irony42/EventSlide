import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Spec 22: the date an album will be deleted is a **host's** fact. It is on the answer a moderator
 * reads about their own event and on no other: not on what a guest's phone is told about the event
 * it joined, not on the public view, not on the projector's wall.
 *
 * A DTO is an interface in `dto.ts`, so the scope is read from there: the only shape that may
 * declare a `purge` field is `EventDto`. A new field of that name on another shape is the way the
 * date would reach a guest or the room, and it fails here, naming the shape.
 */

const SERVER = join(process.cwd(), 'src/interface/http/presenters/dto.ts')

const shapesDeclaring = (field: string): readonly string[] => {
  const source = ts.createSourceFile(
    SERVER,
    readFileSync(SERVER, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  )
  const found: string[] = []
  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue
    const declares = statement.members.some(
      (member) => ts.isPropertySignature(member) && member.name.getText(source) === field,
    )
    if (declares) found.push(statement.name.text)
  }
  return found
}

describe('where the purge date may appear on the wire', () => {
  it('is declared by the host event answer and by no other shape: not a guest, not the public view, not the wall', () => {
    expect(shapesDeclaring('purge')).toEqual(['EventDto'])
  })

  it('finds the field it looks for, so the sweep above cannot pass by reading nothing', () => {
    expect(shapesDeclaring('joinCode').length).toBeGreaterThan(0)
  })
})
