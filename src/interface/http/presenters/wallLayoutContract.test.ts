import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { WALL_LAYOUTS, wallLayoutSpec } from '../../../domain/slideshow/wallLayout'

/**
 * The one domain fact the wire deliberately does not carry, compared against the client's
 * copy of it.
 *
 * `WallLayoutSpec.playsVideo` decides whether a clip plays on the wall or shows its
 * poster frame. It is a domain decision — it is about what a room and a venue mini-PC can
 * bear, exactly as `slotCount` and `crops` are — and yet the server cannot apply it,
 * because **the layout belongs to the screen rather than to the event**: it is chosen in
 * the browser from `?layout=` and the `L` key, and `wallQuery` is `.strict()` and refuses
 * the parameter outright. So `GET /wall` does not know which layout is showing, the
 * response cannot resolve `playsVideo`, and the client has to hold its own copy of the
 * table.
 *
 * This file lives beside `dtoContract.test.ts` for the same reason that one exists: it is
 * a contract between two independently written declarations that nothing else can check.
 * The difference is the direction — that one compares two spellings of the same *wire*,
 * this one compares a domain rule against the mirror the wire made necessary.
 *
 * `WallLayouts.tsx` mirrors `slotCount` the same way and says, accurately, that nothing
 * catches it when the two drift. This is what catching it looks like.
 *
 * Reading a path is not an import: nothing here couples the server's build to the web
 * app's, and the architecture rule forbidding `web` to import `src` stands untouched.
 */

const CLIENT = join(process.cwd(), 'web/src/features/wall/wallLayoutPlayback.ts')

/** The client's `PLAYS_VIDEO` table, read out of its source as booleans by layout. */
const clientTable = (): ReadonlyMap<string, boolean> => {
  const source = ts.createSourceFile(
    CLIENT,
    readFileSync(CLIENT, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  )
  const found = new Map<string, boolean>()

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'PLAYS_VIDEO' &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const layout = property.name.getText(source)
        const value = property.initializer.kind
        if (value === ts.SyntaxKind.TrueKeyword) found.set(layout, true)
        if (value === ts.SyntaxKind.FalseKeyword) found.set(layout, false)
      }
      return
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(source, visit)
  return found
}

const client = clientTable()

describe('which wall layouts play a clip', () => {
  it('found the client’s table at all', () => {
    // Every assertion below is vacuously true against an empty map, so the parser has to
    // prove it still understands the file it reads — a rename of `PLAYS_VIDEO` would
    // otherwise turn this whole suite green and blind.
    expect(client.size).toBe(WALL_LAYOUTS.length)
  })

  it.each([...WALL_LAYOUTS])('the wall and the domain agree about %s', (layout) => {
    // A disagreement is not a crash. It is a projector quietly showing a still where the
    // room was promised a video, or twelve decoders on a box that can afford two — and
    // nothing in either build would say so.
    expect(client.get(layout)).toBe(wallLayoutSpec(layout).playsVideo)
  })
})
