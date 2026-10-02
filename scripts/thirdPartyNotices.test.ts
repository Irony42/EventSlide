import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLockfile, describeRefusals, installedManifests } from './licenseAudit'
import {
  NOTICES_FILE,
  SUPPLEMENTED_PACKAGES,
  assertNoThirdPartyCode,
  bundledPackages,
  collectNotices,
  packageOfModule,
  readNotice,
  renderNotices,
  type PackageNotice,
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
 * below says so.) It is also where the two halves of the item meet: every package that
 * reaches the browser is run through the licence audit **as a shipped package**, because
 * `dev: true` in the lockfile means "pruned from the image", not "never in the bundle" -
 * Vite and rolldown are both, and a development tool imported by mistake would be too.
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
    [
      'a checkout whose directory name holds a # (a C# folder), which is not a fragment',
      'C:/Users/x/C#/EventSlide/node_modules/react/index.js',
      'react',
      'C:/Users/x/C#/EventSlide/node_modules/react',
    ],
    [
      'a checkout whose directory name holds a ?, which is not a query',
      '/home/x/what?/EventSlide/node_modules/react/index.js?v=1',
      'react',
      '/home/x/what?/EventSlide/node_modules/react',
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

    const text = collectNotices([idOf('alpha'), idOf('@scope/beta')], root)

    expect(text).toContain('alpha 1.2.3\nLicence: MIT\n\nALPHA TEXT')
    expect(text).toContain('@scope/beta 4.5.6\nLicence: ISC\nhttps://beta.example\n\nBETA TEXT')
  })

  it('lists only what the bundle contains, once each, however many modules it took', () => {
    install('alpha', { name: 'alpha', version: '1.0.0', license: 'MIT' }, { LICENSE: 'A' })
    install('unused', { name: 'unused', version: '1.0.0', license: 'MIT' }, { LICENSE: 'U' })

    const text = collectNotices(
      [idOf('alpha'), join(root, 'node_modules', 'alpha', 'other.js'), '/app/web/src/main.tsx'],
      root,
    )

    expect(text.match(/^alpha 1\.0\.0$/gm)).toHaveLength(1)
    expect(text).not.toContain('unused')
  })

  it('gives the same bytes for the same packages in any order, with nothing of the machine in them', () => {
    install('alpha', { name: 'alpha', version: '1.0.0', license: 'MIT' }, { LICENSE: 'A' })
    install('beta', { name: 'beta', version: '1.0.0', license: 'MIT' }, { LICENSE: 'B' })

    const forwards = collectNotices([idOf('alpha'), idOf('beta')], root)
    const backwards = collectNotices([idOf('beta'), idOf('alpha')], root)

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

    const text = collectNotices([idOf('alpha')], root)

    expect(text).toContain('ATTRIBUTION')
    expect(text).toContain('APACHE TEXT')
    expect(text).not.toContain('not a licence')
  })

  it.each([
    ['LICENCE, the British spelling', 'LICENCE'],
    ['COPYING', 'COPYING'],
    ['LICENSE-MIT', 'LICENSE-MIT'],
    ['licence.txt, in lower case', 'licence.txt'],
    ['the THIRD-PARTY-LICENSE a package keeps for code it derives from', 'THIRD-PARTY-LICENSE'],
  ])('finds a licence in %s', (_name, file) => {
    install(
      'alpha',
      { name: 'alpha', version: '1.0.0', license: 'MIT' },
      { [file]: 'THE NOTICE', 'README.md': 'not a licence' },
    )

    const text = collectNotices([idOf('alpha')], root)

    expect(text).toContain('THE NOTICE')
    expect(text).not.toContain('not a licence')
  })

  it('writes a package’s several files in name order, not in the order the disk lists them', () => {
    // `readdir` order differs between Windows and Linux; a file that printed differently on
    // the two would make the same release produce two different notice files.
    install(
      'alpha',
      { name: 'alpha', version: '1.0.0', license: '(MIT OR Apache-2.0)' },
      { 'LICENSE-MIT': 'MIT SIDE', 'LICENSE-APACHE': 'APACHE SIDE', NOTICE: 'ATTRIBUTION' },
    )

    const text = collectNotices([idOf('alpha')], root)

    expect(text.indexOf('APACHE SIDE')).toBeLessThan(text.indexOf('MIT SIDE'))
    expect(text.indexOf('MIT SIDE')).toBeLessThan(text.indexOf('ATTRIBUTION'))
  })

  it('normalises line endings, so a Windows checkout and a Linux one print the same file', () => {
    install(
      'alpha',
      { name: 'alpha', version: '1.0.0', license: 'MIT' },
      { LICENSE: 'line one\r\nline two\r\n' },
    )

    expect(collectNotices([idOf('alpha')], root)).toContain('line one\nline two\n')
  })

  it('reads a legacy licence declaration for the heading', () => {
    install(
      'alpha',
      { name: 'alpha', version: '1.0.0', licenses: [{ type: 'MIT' }] },
      { LICENSE: 'A' },
    )

    expect(collectNotices([idOf('alpha')], root)).toContain('Licence: MIT')
  })

  it('fails the build for a bundled package that ships no licence file, whatever it declares', () => {
    // "Declares MIT" does not reproduce MIT's permission text, which is what the licence
    // asks for. The remedy is written into the message.
    install('alpha', { name: 'alpha', version: '1.0.0', license: 'MIT' })

    expect(() => collectNotices([idOf('alpha')], root)).toThrow(
      /alpha is in the bundle and ships no licence file \(it declares MIT\).*SUPPLEMENTS/s,
    )
  })

  it('takes a supplement for a package whose own files do not carry the whole notice', () => {
    // `qrcode.react` is the real case: its LICENSE says it bundles another library, and the
    // other library's copyright and permission text are nowhere in the package.
    install('qrcode.react', { name: 'qrcode.react', version: '4.2.0', license: 'ISC' })
    install('plain', { name: 'plain', version: '1.0.0', license: 'MIT' }, { LICENSE: 'PLAIN' })

    const text = collectNotices([idOf('qrcode.react'), idOf('plain')], root)

    const plain = text.indexOf('plain 1.0.0')
    const qr = text.indexOf('qrcode.react 4.2.0')
    // Under the package it names, with the permission text, and under no other.
    expect(text.indexOf('Copyright (c) Project Nayuki. (MIT License)')).toBeGreaterThan(qr)
    expect(text.indexOf('Permission is hereby granted')).toBeGreaterThan(qr)
    expect(text.slice(plain, qr)).not.toContain('Nayuki')
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

  it('fails the build when code inlined from a package names one that cannot be found', () => {
    // A lockfile that nests rolldown under vite, or a build started from elsewhere, would
    // otherwise drop that notice without a word.
    install('vite', { name: 'vite', version: '8.0.0', license: 'MIT' }, { 'LICENSE.md': 'VITE' })
    const below = join(root, 'web')
    mkdirSync(below)

    expect(() =>
      bundledPackages([`${NUL}vite/preload-helper.js`, `${NUL}rolldown/runtime.js`], below),
    ).toThrow(/inlines code from rolldown/)
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

    const text = collectNotices([`${NUL}vite/preload-helper.js`, idOf('gamma')], web)

    expect(text).toContain('MIT TEXT')
    expect(text).not.toContain('SOMEONE ELSE')
    expect(text).toContain('KEPT, IT IS BUNDLED IN FULL')
  })

  it('keeps a package’s whole licence file when it is also bundled for real, not only inlined', () => {
    install(
      'vite',
      { name: 'vite', version: '8.0.0', license: 'MIT' },
      { 'LICENSE.md': 'CORE\n\n# Licenses of bundled dependencies\nFULL LIST' },
    )
    const web = join(root, 'web')
    mkdirSync(web)

    const text = collectNotices([`${NUL}vite/preload-helper.js`, idOf('vite')], web)

    expect(text).toContain('FULL LIST')
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

  it('orders by code unit, so a machine’s locale cannot reorder the file', () => {
    // `localeCompare` puts "alpha" before "Zebra" in nearly every locale, and "ch" after "h"
    // in Czech. Code units are the same everywhere.
    const notice = (name: string): PackageNotice => ({
      name,
      version: '1.0.0',
      license: 'MIT',
      homepage: undefined,
      texts: [name],
    })

    const text = renderNotices([notice('alpha'), notice('Zebra')])

    expect(text.indexOf('Zebra 1.0.0')).toBeLessThan(text.indexOf('alpha 1.0.0'))
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

  describe('a bundle that promises to hold no third-party code', () => {
    it('passes when every module is the application’s own', () => {
      expect(() =>
        assertNoThirdPartyCode(
          ['/app/web/sw/serviceWorker.ts', '/app/web/src/lib/x.ts'],
          root,
          'sw.js',
        ),
      ).not.toThrow()
    })

    it('fails the build, naming the package, when one is not', () => {
      install('zod', { name: 'zod', version: '3.0.0', license: 'MIT' }, { LICENSE: 'Z' })

      expect(() =>
        assertNoThirdPartyCode(['/app/web/sw/serviceWorker.ts', idOf('zod')], root, 'sw.js'),
      ).toThrow(/sw\.js bundles third-party code \(zod\)/)
    })

    it('counts what the bundler inlines by name as third-party code', () => {
      install('vite', { name: 'vite', version: '8.0.0', license: 'MIT' }, { 'LICENSE.md': 'V' })
      const below = join(root, 'web')
      mkdirSync(below)

      expect(() =>
        assertNoThirdPartyCode([`${NUL}vite/preload-helper.js`], below, 'sw.js'),
      ).toThrow(/sw\.js bundles third-party code \(vite\)/)
    })

    it('is attached to the service worker’s build, which is the bundle that makes the promise', async () => {
      // Importing the config runs no build and reads no file: the manifest it needs is read
      // inside a hook. What matters is that the guard is among the plugins of that build.
      const { default: config } = await import('../web/vite.sw.config')
      const plugins: readonly unknown[] = [config.plugins ?? []].flat(5)
      const names = plugins.map((plugin) =>
        typeof plugin === 'object' && plugin !== null ? Reflect.get(plugin, 'name') : undefined,
      )

      expect(names).toContain('eventslide:no-third-party-code')
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
    // A supplement is for a package that is in the bundle; once it is not, it is stale.
    for (const name of SUPPLEMENTED_PACKAGES) {
      expect(text, `${name} has a supplement but is no longer bundled`).toContain(`\n${name} `)
    }
    expect(text).toContain('Project Nayuki')

    // The audit's `dev: true` means "pruned from the image", and Vite and rolldown are
    // that and in the bundle too. So every package of the real bundle is audited as one
    // that ships: a development exception (MPL, GPL...) does not cover it, and a
    // development tool imported into the client by mistake turns this red.
    const moduleIds = outputs.flatMap((output) => (output.type === 'chunk' ? output.moduleIds : []))
    const bundled = new Set(bundledPackages(moduleIds, join(ROOT, 'web')).map((p) => p.name))
    const lockfile = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, Record<string, unknown>>
    }
    for (const [key, entry] of Object.entries(lockfile.packages)) {
      if (bundled.has(key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length))) {
        delete entry['dev']
      }
    }
    const verdicts = auditLockfile(lockfile, installedManifests(ROOT)).filter((verdict) =>
      bundled.has(verdict.package.name),
    )

    expect(verdicts.length, 'every bundled package is in the lockfile').toBeGreaterThanOrEqual(
      bundled.size,
    )
    expect(describeRefusals(verdicts)).toEqual([])
    expect(verdicts.filter((verdict) => verdict.status === 'excepted')).toEqual([])
  }, 60_000)
})
