import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  NOTICES_FILE,
  bundledPackages,
  collectNotices,
  packageOfModule,
  readNotice,
  type PackageNotice,
  renderNotices,
} from '../web/thirdPartyNotices'

/**
 * The licence notices the web build ships (roadmap G1-07 / P1-09), asserted rather than
 * described.
 *
 * MIT and ISC grant their rights on one condition: the copyright notice and the permission
 * text travel with substantial portions of the software, and a minified bundle is that.
 * Vite's minifier drops the licence comments from it, so before `web/thirdPartyNotices.ts`
 * the JavaScript every guest downloaded carried no notice at all, and nothing noticed:
 * the build was green, the app worked, and the omission was a legal one.
 *
 * Three layers, cheapest first. The id parsing is a table; the reading and rendering run
 * against a throwaway `node_modules`; and the last test runs the **real** client build,
 * in memory, with the real config. That one is the guard on the failure the others cannot
 * see: a bundler upgrade that renames what the plugin reads, which would leave every unit
 * test green and ship an empty file. (The plugin also throws in that case, and a test
 * below says so.)
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NUL = String.fromCharCode(0)

describe('which package a bundled module belongs to', () => {
  it.each([
    ['a plain package', '/app/node_modules/react/index.js', 'react', '/app/node_modules/react'],
    [
      'a Windows path, which the bundler may hand over as is',
      'C:\\app\\node_modules\\react-dom\\cjs\\react-dom.production.js',
      'react-dom',
      'C:/app/node_modules/react-dom',
    ],
    [
      'a scoped package',
      '/app/node_modules/@scope/pkg/dist/index.mjs',
      '@scope/pkg',
      '/app/node_modules/@scope/pkg',
    ],
    [
      'a package nested inside another, which is itself and not its parent',
      '/app/node_modules/outer/node_modules/inner/index.js',
      'inner',
      '/app/node_modules/outer/node_modules/inner',
    ],
    [
      'a query suffix a plugin appended',
      '/app/node_modules/react/index.js?commonjs-es-import',
      'react',
      '/app/node_modules/react',
    ],
    [
      'a virtual wrapper around a real file',
      `${NUL}/app/node_modules/react/index.js?commonjs-module`,
      'react',
      '/app/node_modules/react',
    ],
  ])('is found for %s', (_name, id, name, dir) => {
    expect(packageOfModule(id)).toEqual({ name, dir })
  })

  it.each([
    ['the application’s own code', '/app/web/src/main.tsx'],
    ['a virtual module with no path', `${NUL}vite/preload-helper.js`],
    ['a scope with no package under it', '/app/node_modules/@scope'],
    ['an empty segment', '/app/node_modules/'],
  ])('is nothing for %s', (_name, id) => {
    expect(packageOfModule(id)).toBeUndefined()
  })
})

describe('the notices of a throwaway node_modules', () => {
  let root: string

  /** Writes a package into the fixture's node_modules, with these files beside its manifest. */
  const install = (name: string, manifest: unknown, files: Record<string, string> = {}): string => {
    const dir = join(root, 'node_modules', ...name.split('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)
    return dir
  }

  const idOf = (name: string): string => join(root, 'node_modules', name, 'index.js')

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'notices-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reproduces each bundled package’s licence text under its name, version and licence', () => {
    install('alpha', { name: 'alpha', version: '1.2.3', license: 'MIT' }, { LICENSE: 'ALPHA TEXT' })
    install(
      '@scope/beta',
      { name: '@scope/beta', version: '4.5.6', license: 'ISC', homepage: 'https://beta.example' },
      { 'LICENSE.md': 'BETA TEXT' },
    )

    const { text } = collectNotices([idOf('alpha'), idOf('@scope/beta')], root)

    expect(text).toContain('alpha 1.2.3\nLicence: MIT\n\nALPHA TEXT')
    expect(text).toContain('@scope/beta 4.5.6\nLicence: ISC\nhttps://beta.example\n\nBETA TEXT')
  })

  it('lists only what the bundle contains, once each, however many modules it took', () => {
    install('alpha', { name: 'alpha', version: '1.0.0', license: 'MIT' }, { LICENSE: 'A' })
    install('unused', { name: 'unused', version: '1.0.0', license: 'MIT' }, { LICENSE: 'U' })

    const { text } = collectNotices(
      [idOf('alpha'), join(root, 'node_modules', 'alpha', 'other.js'), '/app/web/src/main.tsx'],
      root,
    )

    expect(text.match(/^alpha 1\.0\.0$/gm)).toHaveLength(1)
    expect(text).not.toContain('unused')
  })

  it('gives the same bytes for the same packages in any order, with nothing of the machine in them', () => {
    install('alpha', { name: 'alpha', version: '1.0.0', license: 'MIT' }, { LICENSE: 'A' })
    install('beta', { name: 'beta', version: '1.0.0', license: 'MIT' }, { LICENSE: 'B' })

    const forwards = collectNotices([idOf('alpha'), idOf('beta')], root).text
    const backwards = collectNotices([idOf('beta'), idOf('alpha')], root).text

    expect(backwards).toBe(forwards)
    expect(forwards.indexOf('alpha 1.0.0')).toBeLessThan(forwards.indexOf('beta 1.0.0'))
    expect(forwards).not.toContain(root)
  })

  it('writes every notice a package ships, NOTICE files included, and not a licence-named script', () => {
    // Apache-2.0 obliges a redistributor to keep a NOTICE file's attributions.
    install(
      'alpha',
      { name: 'alpha', version: '1.0.0', license: 'Apache-2.0' },
      {
        LICENSE: 'APACHE TEXT',
        NOTICE: 'ATTRIBUTION',
        'license.js': 'throw new Error("not a licence")',
      },
    )

    const { text } = collectNotices([idOf('alpha')], root)

    expect(text).toContain('ATTRIBUTION')
    expect(text).toContain('APACHE TEXT')
    expect(text).not.toContain('not a licence')
  })

  it('normalises line endings, so a Windows checkout and a Linux one print the same file', () => {
    install(
      'alpha',
      { name: 'alpha', version: '1.0.0', license: 'MIT' },
      { LICENSE: 'line one\r\nline two\r\n' },
    )

    expect(collectNotices([idOf('alpha')], root).text).toContain('line one\nline two\n')
  })

  it('reads a legacy licence declaration for the heading', () => {
    install(
      'alpha',
      { name: 'alpha', version: '1.0.0', licenses: [{ type: 'MIT' }] },
      { LICENSE: 'A' },
    )

    expect(collectNotices([idOf('alpha')], root).text).toContain('Licence: MIT')
  })

  it('names the licence and warns when a package declares one but ships no file', () => {
    install('alpha', { name: 'alpha', version: '1.0.0', license: 'MIT' })

    const { text, warnings } = collectNotices([idOf('alpha')], root)

    expect(text).toContain('This package ships no licence file; it declares MIT.')
    expect(warnings).toEqual(['alpha@1.0.0 ships no licence file'])
  })

  it('fails the build for a package with nothing to reproduce: no file and no declared licence', () => {
    install('alpha', { name: 'alpha', version: '1.0.0' })

    expect(() => collectNotices([idOf('alpha')], root)).toThrow(/alpha.*no notice to reproduce/s)
  })

  it('fails the build for a bundled package it cannot read', () => {
    mkdirSync(join(root, 'node_modules', 'alpha'), { recursive: true })

    expect(() => collectNotices([idOf('alpha')], root)).toThrow(/cannot read alpha\/package\.json/)
  })

  it('fails the build, rather than ship an empty file, when no module is a third-party one', () => {
    // A bundler upgrade that renamed `moduleIds` would look exactly like this: ids that
    // are all the application's own. An empty notice file is the failure nobody sees.
    expect(() => collectNotices(['/app/web/src/main.tsx'], root)).toThrow(
      /no third-party package was found/,
    )
    expect(() => collectNotices([], root)).toThrow(/no third-party package was found/)
  })

  it('counts the code the bundler inlines from vite and rolldown, found from the build root', () => {
    // The preload helper and the module runtime are written into a chunk by name, with
    // no path: this is the only trace of the two packages whose code they are.
    install('vite', { name: 'vite', version: '8.0.0', license: 'MIT' }, { 'LICENSE.md': 'VITE' })
    install('rolldown', { name: 'rolldown', version: '1.0.0', license: 'MIT' }, { LICENSE: 'RD' })
    const below = join(root, 'web')
    mkdirSync(below)

    const found = bundledPackages(
      [`${NUL}vite/preload-helper.js`, `${NUL}rolldown/runtime.js`, `${NUL}something/else.js`],
      below,
    )

    expect(found.map((location) => location.name)).toEqual(['rolldown', 'vite'])
  })

  it('reproduces only the package’s own licence for code that was inlined, not the list of what it bundles', () => {
    // Vite's licence file goes on for 110 kB of other people's licences, for code in Vite's
    // own distribution. What reached the bundle is a few lines of its preload helper.
    install(
      'vite',
      { name: 'vite', version: '8.0.0', license: 'MIT' },
      {
        'LICENSE.md':
          '# Vite core license\nMIT TEXT\n\n# Licenses of bundled dependencies\nSOMEONE ELSE',
      },
    )
    // A package bundled in full keeps every word of its licence file, whatever it says.
    install(
      'gamma',
      { name: 'gamma', version: '1.0.0', license: 'MIT' },
      { LICENSE: 'GAMMA\n\n# Licenses of bundled dependencies\nKEPT, IT IS BUNDLED IN FULL' },
    )
    const web = join(root, 'web')
    mkdirSync(web)

    const { text } = collectNotices([`${NUL}vite/preload-helper.js`, idOf('gamma')], web)

    expect(text).toContain('MIT TEXT')
    expect(text).not.toContain('SOMEONE ELSE')
    expect(text).toContain('KEPT, IT IS BUNDLED IN FULL')
  })

  it('orders notices by name, then version, whatever order it is handed them in', () => {
    const notice = (name: string, version: string): PackageNotice => ({
      name,
      version,
      license: 'MIT',
      homepage: undefined,
      texts: [`${name} ${version} text`],
    })

    const text = renderNotices([
      notice('beta', '1.0.0'),
      notice('alpha', '2.0.0'),
      notice('alpha', '1.0.0'),
    ])

    const order = ['alpha 1.0.0\n', 'alpha 2.0.0\n', 'beta 1.0.0\n'].map((heading) =>
      text.indexOf(heading),
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((at) => at > 0)).toBe(true)
  })

  it('renders nothing but the header and a rule for no packages, never throwing', () => {
    expect(renderNotices([])).toMatch(/^EventSlide - licence notices[\s\S]*\n-+\n$/)
  })

  it('reads a package’s notice without needing the bundler', () => {
    const dir = install(
      'alpha',
      { name: 'alpha', version: '1.0.0', license: 'MIT' },
      { LICENSE: 'A' },
    )

    expect(readNotice({ name: 'alpha', dir })).toEqual({
      name: 'alpha',
      version: '1.0.0',
      license: 'MIT',
      homepage: undefined,
      texts: ['A'],
    })
  })
})

describe('the page that links the notices', () => {
  it('links the very file name the build writes', () => {
    // The browser bundle may not import `NOTICES_FILE`, which reads the disk, so
    // `AboutPage.tsx` spells the address out. This is what keeps the two spellings one.
    const page = readFileSync(
      join(ROOT, 'web', 'src', 'features', 'about', 'AboutPage.tsx'),
      'utf8',
    )

    expect(page).toContain(`'/${NOTICES_FILE}'`)
  })
})

describe('the real client build', () => {
  it(`emits ${NOTICES_FILE} with react, react-dom, react-router and qrcode.react in it`, async () => {
    // In memory (`write: false`), with the config `npm run build:client` uses. This is the
    // test that goes red when a bundler upgrade changes what the plugin reads, or when the
    // plugin is taken out of the config, and the unit tests above cannot.
    const result = await build({
      configFile: join(ROOT, 'web', 'vite.config.ts'),
      logLevel: 'silent',
      build: { write: false, sourcemap: false, manifest: false },
    })
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) =>
      'output' in one ? one.output : [],
    )
    const notices = outputs.filter((output) => output.fileName === NOTICES_FILE)

    expect(notices).toHaveLength(1)
    const asset = notices[0]
    const text =
      asset?.type === 'asset' && typeof asset.source === 'string' ? asset.source : undefined
    expect(text, 'the notices file is a text asset').toBeDefined()

    // The three the plan names, and the two they cannot run without.
    for (const name of ['react', 'react-dom', 'react-router', 'qrcode.react', 'scheduler']) {
      expect(text, `${name} is in the bundle and must be in the notices`).toMatch(
        new RegExp(`^${name.replace('.', '\\.')} \\d+\\.\\d+\\.\\d+`, 'm'),
      )
    }
    // Each block carries the permission text, not only a name: that is the obligation.
    expect(text).toContain('Permission is hereby granted')
    // Nothing from the server side leaked in through a shared import.
    expect(text).not.toMatch(/^(?:express|sharp|better-sqlite3|nodemailer) \d/m)
  }, 60_000)
})
