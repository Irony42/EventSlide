/**
 * Format a file the moment it is written, so `prettier --check .` cannot go red later.
 *
 * `npm run format:check` runs over the whole repository, `.github` and `.claude`
 * included. Twice in one week a file written by a tool — a Dependabot config from the
 * GitHub UI, then a settings file and a CLAUDE.md section from an installer — landed
 * unformatted and turned `main` red. The cost was never the fix, which was one byte both
 * times; it was that every open pull request went red on a file it had not touched, and
 * somebody had to establish that before dismissing it.
 *
 * A prompt cannot prevent this: the file is not always written by whoever is reading the
 * conventions. A hook can, because it runs on the write itself.
 *
 * Deliberately narrow. It formats only what Prettier already claims — a file with no
 * inferred parser, or one `.prettierignore` covers, is left exactly as written. It never
 * changes what a file means, only how it is laid out, and it stays silent unless it
 * actually reformatted something or could not run at all.
 */

import { readFile, writeFile } from 'node:fs/promises'
import * as prettier from 'prettier'

const read = async (stream) => {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const main = async () => {
  const raw = await read(process.stdin)
  if (!raw.trim()) return

  /** A hook that throws on a payload shape it did not expect would block an edit. */
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return
  }

  const path = payload?.tool_input?.file_path
  if (typeof path !== 'string' || path.length === 0) return

  const info = await prettier.getFileInfo(path, { resolveConfig: true })
  if (info.ignored || info.inferredParser === null) return

  const before = await readFile(path, 'utf8')
  const options = await prettier.resolveConfig(path)
  const after = await prettier.format(before, { ...options, filepath: path })

  if (after === before) return

  await writeFile(path, after, 'utf8')
  // One line, on the write that needed it. Silence on every other write is the point:
  // a hook that announces itself constantly is a hook people turn off.
  console.log(`formatted ${path}`)
}

main().catch((error) => {
  // Never fail the edit. A formatter that blocks work when it breaks is worse than the
  // red pipeline it exists to prevent — but say so, or it fails silently forever.
  console.error(`format-edited-file hook did not run: ${error?.message ?? error}`)
})
