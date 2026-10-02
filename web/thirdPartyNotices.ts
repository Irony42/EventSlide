import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * The licence notices of the libraries the web build bundles (roadmap G1-07 / P1-09).
 *
 * MIT and ISC, which cover almost everything React ships, grant their rights on one
 * condition: the copyright notice and the permission text travel with **substantial
 * portions** of the software. A minified bundle is exactly that, and Vite's minifier
 * drops the licence comments from it. Before this plugin the JavaScript every guest
 * downloaded carried no notice at all.
 *
 * So the build emits `third-party-licenses.txt` beside the bundle, listing each package
 * whose code is in it with the text its own licence file gives. `/about` links to it, and
 * `licenseAudit.test.ts` is the other half of the same item: it checks what the licences
 * *are*; this ships what they *ask for*.
 *
 * **Read from the bundle, not from `package.json`.** The packages named in
 * `dependencies` include the whole server, none of which the browser ever receives, and
 * the ones that are bundled include transitive packages nobody listed. The bundler knows
 * which modules it put in which chunk, so the list is theirs.
 *
 * **Fails closed.** A notice file that is quietly incomplete is worse than a failed
 * build, so the build stops when
 * - no third-party module can be found in the bundle at all (this plugin stopped
 *   understanding its input: a bundler upgrade renaming `moduleIds` would do it);
 * - a helper the bundler inlined (`\0vite/...`) names a package that cannot be found;
 * - a bundled package ships no licence file. Add its text to {@link SUPPLEMENTS}, with the
 *   reason, rather than ship the package without the notice its licence asks for.
 *
 * The same walk guards the service worker (`noThirdPartyCode`): `sw.js` is the second
 * script every phone downloads, it bundles nothing from `node_modules` today, and the day
 * it does, the build says so instead of shipping it without a notice.
 *
 * No Node imports besides `fs` and `path`, and no dependence on the rest of `web/`, so a
 * test in `scripts/` can import it, as `scripts/aboutBuildInfo.test.ts` does `buildInfo.ts`.
 */

export const NOTICES_FILE = 'third-party-licenses.txt'

/** The marker bundlers put in front of the id of a module that is not a file. */
const VIRTUAL = String.fromCharCode(0)

/**
 * Modules the bundler writes into a chunk itself, named by a virtual id. The preload
 * helper and the runtime are code from these two packages, inlined, so their licence
 * is among the ones that travel. Any other virtual id is some plugin's own module and is
 * left alone: it carries no package.
 */
const VIRTUAL_PACKAGES: readonly (readonly [prefix: string, name: string])[] = [
  [`${VIRTUAL}vite/`, 'vite'],
  [`${VIRTUAL}rolldown/`, 'rolldown'],
]

const NODE_MODULES = '/node_modules/'

/** Strings are compared by code unit: the same bytes on every machine, whatever its locale. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Where one package lives, and what it is called. */
export interface PackageLocation {
  readonly name: string
  readonly dir: string
  /**
   * Only a few lines of this package are in the bundle (a helper the bundler wrote into a
   * chunk by name), not its distribution. Its licence file may go on to list the licences
   * of everything its own distribution bundles; those notices belong to code we do not
   * ship, and Vite's alone is 110 kB, so only the package's own licence is reproduced.
   */
  readonly inlined?: true
}

/** Where a licence file turns from the package's own licence to its bundled dependencies'. */
const BUNDLED_DEPENDENCIES = /^#+\s*Licen[cs]es of bundled dependencies\b/im

/** The package's own licence: everything above the list of what it bundles, if there is one. */
const ownLicence = (text: string): string => {
  const at = text.search(BUNDLED_DEPENDENCIES)
  return at === -1 ? text : text.slice(0, at).trim()
}

/**
 * The package a bundled module id belongs to, or `undefined` for the application's own
 * code. Reads the **last** `node_modules` segment, so a package nested inside another is
 * itself and not its parent, and tolerates Windows separators and a `?query` suffix. Only a
 * query on the last segment is dropped: `#` and `?` can appear in a directory name, and a
 * checkout under `C:\Users\x\C#\EventSlide` must not make every package vanish.
 */
export const packageOfModule = (moduleId: string): PackageLocation | undefined => {
  const path = (moduleId.startsWith(VIRTUAL) ? moduleId.slice(1) : moduleId)
    .replaceAll('\\', '/')
    .replace(/\?[^/]*$/, '')
  const at = path.lastIndexOf(NODE_MODULES)
  if (at === -1) return undefined

  const [first, second] = path.slice(at + NODE_MODULES.length).split('/')
  if (first === undefined || first === '') return undefined
  if (!first.startsWith('@')) {
    return { name: first, dir: `${path.slice(0, at)}${NODE_MODULES}${first}` }
  }
  if (second === undefined || second === '') return undefined
  return {
    name: `${first}/${second}`,
    dir: `${path.slice(0, at)}${NODE_MODULES}${first}/${second}`,
  }
}

/** Walks up from `start` to the nearest `node_modules/<name>`, as Node would resolve it. */
const installedPackage = (start: string, name: string): string | undefined => {
  let directory = start.replaceAll('\\', '/')
  for (;;) {
    const candidate = `${directory}${NODE_MODULES}${name}`
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = directory.slice(0, directory.lastIndexOf('/'))
    if (parent === directory || parent === '') return undefined
    directory = parent
  }
}

/**
 * Every package whose code is in the given modules, once each, in a stable order.
 * Throws for an inlined helper whose package cannot be found from `root`, because its
 * notice would otherwise be dropped without a word.
 */
export const bundledPackages = (
  moduleIds: Iterable<string>,
  root: string,
): readonly PackageLocation[] => {
  const found = new Map<string, PackageLocation>()
  for (const id of moduleIds) {
    let location = packageOfModule(id)
    if (location === undefined) {
      const virtual = VIRTUAL_PACKAGES.find(([prefix]) => id.startsWith(prefix))
      if (virtual !== undefined) {
        const dir = installedPackage(root, virtual[1])
        if (dir === undefined) {
          throw new Error(
            `third-party notices: the bundle inlines code from ${virtual[1]} (${JSON.stringify(id)}) ` +
              `but no node_modules/${virtual[1]} is reachable from ${root}`,
          )
        }
        location = { name: virtual[1], dir, inlined: true }
      }
    }
    if (location === undefined) continue
    // A package seen both ways is bundled in earnest: its whole licence file applies.
    const seen = found.get(location.dir)
    if (seen === undefined || (seen.inlined === true && location.inlined !== true)) {
      found.set(location.dir, location)
    }
  }
  return [...found.values()].sort((a, b) => byCodeUnit(a.dir, b.dir))
}

const MIT_PERMISSION = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
].join('\n\n')

/**
 * Notices a package's own licence file does not reproduce, by package name, appended to
 * what it ships. Each entry says why it is here. An entry whose package is no longer in
 * the bundle is a failure (`scripts/thirdPartyNotices.test.ts`), so the table cannot rot.
 *
 * - `qrcode.react` is ISC and its LICENSE says it "bundles QR Code Generator ... under a
 *   MIT license", but the npm package carries neither that library's copyright line nor
 *   its permission text, only a source comment (`@license ... Copyright (c) Project
 *   Nayuki. SPDX-License-Identifier: MIT`) that minification drops. The text below is the
 *   standard MIT permission text for the holder that comment names.
 */
const SUPPLEMENTS: ReadonlyMap<string, string> = new Map([
  [
    'qrcode.react',
    [
      'Also bundled in qrcode.react: QR Code generator library (TypeScript)',
      'Copyright (c) Project Nayuki. (MIT License)',
      'https://www.nayuki.io/page/qr-code-generator-library',
      MIT_PERMISSION,
    ].join('\n\n'),
  ],
])

/** The packages {@link SUPPLEMENTS} speaks for. */
export const SUPPLEMENTED_PACKAGES: readonly string[] = [...SUPPLEMENTS.keys()]

export interface PackageNotice {
  readonly name: string
  readonly version: string
  /** The SPDX string the package declares, if it declares one. */
  readonly license: string | undefined
  readonly homepage: string | undefined
  /** The package's own licence and notice files, then any supplement, verbatim. */
  readonly texts: readonly string[]
}

/**
 * `LICENSE`, `LICENCE`, `LICENSE.md`, `LICENSE-MIT`, `COPYING`, `NOTICE`, and the
 * `THIRD-PARTY-LICENSE` a package keeps for the code it derives from: not `license.d.ts`.
 */
const LICENSE_FILE = /^(?:third[-_]?party[-_])?(?:licen[cs]es?|copying|notice)(?:[-._][\w.-]*)?$/i
const NOT_TEXT = /\.(?:[cm]?[jt]s|json|map)$/i

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const urlOf = (manifest: Record<string, unknown>): string | undefined => {
  const homepage = asText(manifest['homepage'])
  if (homepage !== undefined) return homepage
  const repository = manifest['repository']
  const url =
    typeof repository === 'object' && repository !== null
      ? asText(Reflect.get(repository, 'url'))
      : asText(repository)
  return url?.replace(/^git\+/, '').replace(/\.git$/, '')
}

const licenseOf = (manifest: Record<string, unknown>): string | undefined => {
  const single = manifest['license']
  if (typeof single === 'object' && single !== null) return asText(Reflect.get(single, 'type'))
  const text = asText(single)
  if (text !== undefined) return text
  const several = manifest['licenses']
  if (!Array.isArray(several)) return undefined
  const types = several.map((item: unknown) =>
    typeof item === 'object' && item !== null ? asText(Reflect.get(item, 'type')) : asText(item),
  )
  return types.length > 0 && types.every((type) => type !== undefined)
    ? types.join(' OR ')
    : undefined
}

/** The notice of one installed package. Throws if there is nothing to reproduce. */
export const readNotice = (location: PackageLocation): PackageNotice => {
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readFileSync(join(location.dir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
  } catch (cause) {
    throw new Error(
      `third-party notices: cannot read ${location.name}/package.json in ${location.dir}`,
      { cause },
    )
  }

  const supplement = SUPPLEMENTS.get(location.name)
  const texts = [
    ...readdirSync(location.dir, { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && LICENSE_FILE.test(entry.name) && !NOT_TEXT.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort(byCodeUnit)
      .map((name) => readFileSync(join(location.dir, name), 'utf8').replaceAll('\r\n', '\n').trim())
      .map((text) => (location.inlined === true ? ownLicence(text) : text))
      .filter((text) => text !== ''),
    ...(supplement === undefined ? [] : [supplement]),
  ]

  if (texts.length === 0) {
    throw new Error(
      `third-party notices: ${location.name} is in the bundle and ships no licence file ` +
        `(it declares ${licenseOf(manifest) ?? 'no licence'}); add its notice to SUPPLEMENTS ` +
        `in web/thirdPartyNotices.ts, or stop bundling it`,
    )
  }
  return {
    name: asText(manifest['name']) ?? location.name,
    version: asText(manifest['version']) ?? 'unknown',
    license: licenseOf(manifest),
    homepage: urlOf(manifest),
    texts,
  }
}

const RULE = '-'.repeat(78)

const HEADER = [
  'EventSlide - licence notices of the libraries in the web application',
  '',
  'The JavaScript this server sends to your browser contains the open-source packages',
  'listed below. Each is reproduced here with the licence its authors published, as',
  'their licences require. EventSlide itself is free software under the GNU Affero',
  'General Public License, version 3 only; /about links to its source code.',
  '',
  'Server-side components (sharp, libvips, ffmpeg and the rest) are not part of what',
  'is sent to your browser, and are named in the NOTICE file of the source code.',
].join('\n')

/** The file's text. The same notices give the same bytes: no date, no path, no host. */
export const renderNotices = (notices: readonly PackageNotice[]): string => {
  const ordered = [...notices].sort(
    (a, b) => byCodeUnit(a.name, b.name) || byCodeUnit(a.version, b.version),
  )
  const blocks = ordered.map((notice) =>
    [
      RULE,
      `${notice.name} ${notice.version}`,
      ...(notice.license === undefined ? [] : [`Licence: ${notice.license}`]),
      ...(notice.homepage === undefined ? [] : [notice.homepage]),
      '',
      notice.texts.join('\n\n'),
    ].join('\n'),
  )
  return `${[HEADER, ...blocks].join('\n\n')}\n\n${RULE}\n`
}

/**
 * The notices for the modules a build produced. Throws when none of them is a third-party
 * package, because a plugin that finds nothing has stopped working, not found nothing.
 */
export const collectNotices = (moduleIds: Iterable<string>, root: string): string => {
  const packages = bundledPackages(moduleIds, root)
  if (packages.length === 0) {
    throw new Error(
      'third-party notices: no third-party package was found among the bundled modules; ' +
        'the bundler output no longer looks the way this plugin reads it',
    )
  }
  return renderNotices(packages.map(readNotice))
}

/** Every module id of every chunk of a build. */
const moduleIdsOf = (bundle: Record<string, { type: string; moduleIds?: string[] }>): string[] =>
  Object.values(bundle).flatMap((output) =>
    output.type === 'chunk' ? (output.moduleIds ?? []) : [],
  )

/** Emits `third-party-licenses.txt` next to the bundle. See the top of this file. */
export const thirdPartyNotices = (): Plugin => {
  let root = process.cwd()
  return {
    name: 'eventslide:third-party-notices',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: NOTICES_FILE,
        source: collectNotices(moduleIdsOf(bundle), root),
      })
    },
  }
}

/**
 * Throws when the modules of a build include any third-party code, for a bundle that
 * promises to contain none and so ships no notices.
 */
export const assertNoThirdPartyCode = (
  moduleIds: Iterable<string>,
  root: string,
  bundleName: string,
): void => {
  const found = bundledPackages(moduleIds, root)
  if (found.length > 0) {
    throw new Error(
      `${bundleName} bundles third-party code (${found.map((location) => location.name).join(', ')}) ` +
        `and ships no licence notices for it; attach thirdPartyNotices() to its build ` +
        `under another file name, or take the import out`,
    )
  }
}

/** The check for a bundle that has no notices because it should have no third-party code. */
export const noThirdPartyCode = (bundleName: string): Plugin => {
  let root = process.cwd()
  return {
    name: 'eventslide:no-third-party-code',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    generateBundle(_options, bundle) {
      assertNoThirdPartyCode(moduleIdsOf(bundle), root, bundleName)
    },
  }
}
