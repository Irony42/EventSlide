import { describe, expect, it } from 'vitest'
import { parseWorkflow, valueAt } from './workflowYaml'

/**
 * The reader the workflow tests stand on (`releasePipeline.test.ts`, `workflowPinning.test.ts`).
 *
 * A guard that reads the wrong thing is worse than none, because it is green: a `permissions:`
 * attributed to the wrong job, or a `run:` script that comes back with its comments cut off,
 * would let the tests above pass over a broken pipeline. So the reader is tested on the shapes
 * the workflows use, and on every shape it refuses.
 */

describe('parseWorkflow, on the shapes the workflows are written in', () => {
  it('reads nested mappings, and a key with nothing after it as null', () => {
    expect(
      parseWorkflow('on:\n  push:\n    tags: x\n  workflow_dispatch:\nname: Release\n'),
    ).toEqual({
      on: { push: { tags: 'x' }, workflow_dispatch: null },
      name: 'Release',
    })
  })

  it('reads a key with nothing after it on the last line as null', () => {
    expect(parseWorkflow('a: 1\nb:')).toEqual({ a: '1', b: null })
  })

  it('reads a bare dash as an empty item, first or last', () => {
    expect(parseWorkflow('list:\n  -\n  - a')).toEqual({ list: [null, 'a'] })
    expect(parseWorkflow('list:\n  - a\n  -')).toEqual({ list: ['a', null] })
  })

  it('reads every scalar as a string, quotes and comments removed', () => {
    const parsed = parseWorkflow(
      [
        'a: true',
        'b: 3',
        "c: 'it''s # not a comment'",
        'd: "say \\"hi\\""',
        'e: plain value # a comment',
        "f: 'a: b'",
        "'quoted key': x",
        'url: https://example.com/a#b',
      ].join('\n'),
    )

    expect(parsed).toEqual({
      a: 'true',
      b: '3',
      c: "it's # not a comment",
      d: 'say "hi"',
      e: 'plain value',
      f: 'a: b',
      'quoted key': 'x',
      url: 'https://example.com/a#b',
    })
  })

  it('reads an apostrophe inside a plain value as text, and still cuts the comment after it', () => {
    expect(parseWorkflow("name: Syft's own format # why\nrun: echo it's fine\n")).toEqual({
      name: "Syft's own format",
      run: "echo it's fine",
    })
  })

  it('reads a flow sequence on one line, and an empty one, and an empty mapping', () => {
    expect(parseWorkflow("a: ['v*', b]\nb: []\nc: {}\n")).toEqual({ a: ['v*', 'b'], b: [], c: {} })
  })

  it("reads a sequence of scalars, and a sequence at the key's own indentation", () => {
    expect(parseWorkflow('a:\n  - x\n  - "y"\nb:\n- p\n- q\nc: z\n')).toEqual({
      a: ['x', 'y'],
      b: ['p', 'q'],
      c: 'z',
    })
  })

  it('reads a sequence of mappings, whether the first key is on the dash line or below it', () => {
    const parsed = parseWorkflow(
      [
        'steps:',
        '  - uses: actions/checkout@abc # v1',
        '    with:',
        '      depth: 0',
        '  - name: second',
        '    run: echo hi',
        '  -',
        '    name: third',
        '  -   name: fourth',
        '      run: x',
        '  -',
        'after: 1',
      ].join('\n'),
    )

    expect(parsed).toEqual({
      steps: [
        { uses: 'actions/checkout@abc', with: { depth: '0' } },
        { name: 'second', run: 'echo hi' },
        { name: 'third' },
        { name: 'fourth', run: 'x' },
        null,
      ],
      after: '1',
    })
  })

  it('reads a block scalar as its lines, dedented, with comments and blank lines kept', () => {
    const parsed = parseWorkflow(
      [
        'jobs:',
        '  a:',
        '    steps:',
        '      - run: |',
        '          set -e',
        '          # this stays',
        '',
        '          if true; then',
        '            echo "nested: yes"',
        '          fi',
        '',
        '        name: after the script',
        '      - run: |',
        '      - run: |',
        '',
        '        name: empty',
        'last: x',
      ].join('\n'),
    )

    expect(parsed).toEqual({
      jobs: {
        a: {
          steps: [
            {
              run: 'set -e\n# this stays\n\nif true; then\n  echo "nested: yes"\nfi\n',
              name: 'after the script',
            },
            { run: '' },
            { run: '', name: 'empty' },
          ],
        },
      },
      last: 'x',
    })
  })

  it('reads a block scalar that ends the file', () => {
    expect(parseWorkflow('run: |\n  one\n  two')).toEqual({ run: 'one\ntwo\n' })
  })

  it('ignores comment-only lines, blank lines and Windows line endings', () => {
    expect(parseWorkflow('# top\r\n\r\na: 1\r\n  # indented comment\r\nb:\r\n  c: 2\r\n')).toEqual({
      a: '1',
      b: { c: '2' },
    })
  })

  it('reads an empty file as an empty mapping', () => {
    expect(parseWorkflow('')).toEqual({})
    expect(parseWorkflow('# nothing\n')).toEqual({})
  })
})

describe('parseWorkflow, on what it refuses rather than guesses', () => {
  it.each([
    ['a tab', 'a:\n\tb: 1', 'tabs'],
    ['an anchor', 'a: &x 1', 'anchors'],
    ['an alias', 'a: *x', 'anchors'],
    ['a tag', 'a: !!str 1', 'anchors'],
    ['a folded scalar', 'a: >\n  text', 'folded'],
    ['a chomped block scalar', 'a: |-\n  text', 'plain |'],
    ['a flow sequence over several lines', 'a: [x,\n  y]', 'close on its own line'],
    ['a flow mapping with content', 'a: {b: 1}', 'empty {}'],
    ['an unterminated quote', "a: 'x", 'unterminated'],
    ['a lone quote', "a: '", 'unterminated'],
    [
      'a plain value with a colon and a space',
      'name: Push the image: sign it',
      'colon and a space',
    ],
    ['a plain value that ends in a colon', 'name: Push:', 'colon and a space'],
    ['a plain value that starts with @', 'a: @here', 'cannot start with @'],
    ['a plain value that starts with a backtick', 'a: `x`', 'cannot start with `'],
    ['a plain value that starts with %', 'a: %x', 'cannot start with %'],
    ['a sequence inside a sequence item', 'a:\n  - - x', 'sequence inside a sequence'],
    ['an escape other than a quote', String.raw`a: "x\ny"`, 'is supported as an escape'],
    ['a second document', 'a: 1\n---\nb: 2', 'several documents'],
    ['a line with no colon', 'a: 1\nnot a mapping', 'expected "key: value"'],
    ['a duplicate key', 'a: 1\nb: 2\na: 3', 'duplicate key "a"'],
    ['a list where a key belongs', 'a: 1\n- b', 'list item'],
    ['text that is not at the indentation of its mapping', 'a:\n    b: 1\n  c: 2', 'indentation'],
  ])('throws on %s, saying what it was', (_name, source, message) => {
    expect(() => parseWorkflow(source)).toThrow(message)
  })

  it('names the line of the problem', () => {
    expect(() => parseWorkflow('a: 1\nb: 2\nc: &x 3')).toThrow('line 3')
  })
})

describe('valueAt', () => {
  const root = parseWorkflow('a:\n  b:\n    - x\n  c: y\n')

  it('follows a path of keys', () => {
    expect(valueAt(root, 'a', 'c')).toBe('y')
    expect(valueAt(root, 'a', 'b')).toEqual(['x'])
    expect(valueAt(root)).toBe(root)
  })

  it('answers undefined for a key that is missing, and for a step through a list or a scalar', () => {
    expect(valueAt(root, 'a', 'missing')).toBeUndefined()
    expect(valueAt(root, 'a', 'b', '0')).toBeUndefined()
    expect(valueAt(root, 'a', 'c', 'd')).toBeUndefined()
    expect(valueAt(undefined, 'a')).toBeUndefined()
    expect(valueAt(null, 'a')).toBeUndefined()
  })
})
