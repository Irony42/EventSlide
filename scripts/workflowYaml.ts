/**
 * A reader for the small subset of YAML that this repository's GitHub workflows are written
 * in, so that a test can ask "what are the permissions of the `sign` job" instead of
 * grepping for a word that may sit in a comment or in another job.
 *
 * It exists because the repository has no YAML dependency and a test that guards a release
 * pipeline should not be written as a regular expression over the whole file: `permissions:`
 * under the wrong job, `branches:` under the wrong trigger and `uses:` inside a shell
 * heredoc all match a text search and mean something else.
 *
 * What it reads: block mappings and sequences, plain and quoted scalars, `[a, b]` flow
 * sequences on one line, an empty `{}`, `|` block scalars, comments. Every scalar is a
 * string: `true` and `3` come back as `'true'` and `'3'`, which is what a workflow
 * expression sees of them anyway. What it does not read, it **throws on** rather than
 * guessing: anchors, aliases, tags, several documents, folded `>` scalars, chomping markers
 * on a `|`, a flow mapping with content, a flow sequence over several lines, a duplicate key,
 * a tab. A workflow that needs one of those fails the tests that read it, by name, instead of
 * being half understood.
 */

export type YamlValue = string | null | YamlValue[] | { [key: string]: YamlValue }

export type YamlMap = { [key: string]: YamlValue }

interface Line {
  /** 1-based, for the error messages and to find the line after a block scalar. */
  readonly number: number
  readonly indent: number
  /** Trimmed. */
  readonly text: string
  /** As it is in the file: a block scalar keeps its comments and its relative indentation. */
  readonly raw: string
}

const fail = (line: Line | undefined, message: string): never => {
  throw new Error(`workflow YAML, line ${line?.number ?? 'end'}: ${message}`)
}

const isItem = (text: string): boolean => /^-( |$)/.test(text)

/** `text` without a trailing ` # comment`, unless the `#` is inside quotes. */
const withoutComment = (text: string): string => {
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i)
    if (quote !== '') {
      if (char === quote) quote = ''
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === '#' && (i === 0 || text.charAt(i - 1) === ' ')) {
      return text.slice(0, i).trimEnd()
    }
  }
  return text.trimEnd()
}

const unquote = (text: string, line: Line): string => {
  const first = text.charAt(0)
  if (first !== "'" && first !== '"') return text
  if (text.length < 2 || !text.endsWith(first)) return fail(line, `unterminated quote: ${text}`)
  const inside = text.slice(1, -1)
  return first === "'" ? inside.replaceAll("''", "'") : inside.replaceAll('\\"', '"')
}

const scalar = (text: string, line: Line): YamlValue => {
  if (text === '') return null
  if (/^[&*!]/.test(text)) return fail(line, `anchors, aliases and tags are not supported: ${text}`)
  if (text.startsWith('>')) return fail(line, 'folded block scalars (>) are not supported')
  if (text.startsWith('|')) return fail(line, `only a plain | block scalar is supported: ${text}`)
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) return fail(line, 'a flow sequence has to close on its own line')
    const inside = text.slice(1, -1).trim()
    return inside === '' ? [] : inside.split(',').map((item) => unquote(item.trim(), line))
  }
  if (text.startsWith('{')) {
    return text === '{}' ? {} : fail(line, 'only an empty {} is supported as a flow mapping')
  }
  return unquote(text, line)
}

/** Where `key: value` splits: the first `:` outside quotes that ends the text or precedes a space. */
const splitKey = (text: string, line: Line): { key: string; rest: string } => {
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i)
    if (quote !== '') {
      if (char === quote) quote = ''
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === ':' && (i === text.length - 1 || text.charAt(i + 1) === ' ')) {
      return { key: unquote(text.slice(0, i).trim(), line), rest: text.slice(i + 1).trim() }
    }
  }
  return fail(line, `expected "key: value", got: ${text}`)
}

export const parseWorkflow = (source: string): YamlMap => {
  const all: Line[] = source.split('\n').map((text, index) => {
    const raw = text.replace(/\r$/, '')
    const line = { number: index + 1, indent: raw.length - raw.trimStart().length, raw }
    if (/^ *\t/.test(raw)) return fail({ ...line, text: raw.trim() }, 'tabs are not supported')
    return { ...line, text: raw.trim() }
  })
  // Blank lines and comment-only lines carry nothing, except inside a block scalar, which
  // reads `all` and not this.
  const lines = all.filter((line) => line.text !== '' && !line.text.startsWith('#'))
  const marker = lines.find((line) => line.text === '---' || line.text === '...')
  if (marker !== undefined) fail(marker, 'several documents are not supported')

  let cursor = 0

  /** The lines of a `|` block scalar whose key sits at `keyIndent`, dedented, one trailing newline. */
  const blockScalar = (key: Line, keyIndent: number): string => {
    let end = key.number // the index in `all` of the line after the key
    for (const line of all.slice(end)) {
      if (line.text !== '' && line.indent <= keyIndent) break
      end++
    }
    cursor = lines.findIndex((line) => line.number > end)
    if (cursor === -1) cursor = lines.length
    const body = all.slice(key.number, end)
    while (body.length > 0 && body[body.length - 1]?.text === '') body.pop()
    if (body.length === 0) return ''
    const base = Math.min(...body.filter((line) => line.text !== '').map((line) => line.indent))
    return (
      body.map((line) => line.raw.slice(Math.min(base, line.indent)).trimEnd()).join('\n') + '\n'
    )
  }

  /** What follows `key:`, with the key's line already consumed. */
  const valueOf = (rest: string, key: Line, indent: number): YamlValue => {
    const text = withoutComment(rest)
    if (text === '|') return blockScalar(key, indent)
    if (text !== '') return scalar(text, key)
    const next = lines[cursor]
    if (next === undefined) return null
    // A nested block, or `key:` followed by `- item` at the key's own indentation.
    if (next.indent > indent || (next.indent === indent && isItem(next.text))) {
      return block(next)
    }
    return null
  }

  const sequence = (indent: number): YamlValue[] => {
    const items: YamlValue[] = []
    for (;;) {
      const line = lines[cursor]
      if (line === undefined || line.indent !== indent || !isItem(line.text)) return items
      const rest = line.text.slice(1)
      const inner = rest.trimStart()
      const body = withoutComment(inner)
      if (body === '') {
        cursor++
        const next = lines[cursor]
        items.push(next !== undefined && next.indent > indent ? block(next) : null)
      } else if (/^(["'][^"']*["']|[^\s"'[{]+?):( |$)/.test(body)) {
        // `- key: value`: the item is a mapping, and this line is its first, moved right.
        const itemIndent = indent + 1 + (rest.length - inner.length)
        lines[cursor] = { ...line, indent: itemIndent, text: inner }
        items.push(mapping(itemIndent))
      } else {
        cursor++
        items.push(scalar(body, line))
      }
    }
  }

  const mapping = (indent: number): YamlMap => {
    const map: YamlMap = {}
    for (;;) {
      const line = lines[cursor]
      if (line === undefined || line.indent !== indent) return map
      if (isItem(line.text)) return fail(line, 'a list item where a key was expected')
      const { key, rest } = splitKey(line.text, line)
      if (Object.hasOwn(map, key)) fail(line, `duplicate key "${key}"`)
      cursor++
      map[key] = valueOf(rest, line, indent)
    }
  }

  const block = (first: Line): YamlValue =>
    isItem(first.text) ? sequence(first.indent) : mapping(first.indent)

  const first = lines[0]
  if (first === undefined) return {}
  const top = mapping(first.indent)
  if (cursor < lines.length) fail(lines[cursor], 'unexpected indentation')
  return top
}

/** The value at a path of keys, or `undefined` when any step of it is missing. */
export const valueAt = (
  root: YamlValue | undefined,
  ...path: readonly string[]
): YamlValue | undefined => {
  let current: YamlValue | undefined = root
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = current[key]
  }
  return current
}
