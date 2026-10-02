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
 * **Fail closed where it is cheap.** A bundle in which no third-party module can be
 * found means this plugin stopped understanding its input (a bundler upgrade renaming
 * `moduleIds` would do it), and shipping an empty notice file without a word is worse
 * than a failed build. A package whose licence text cannot be found at all fails too;
 * one that declares a licence but ships no file gets a notice naming the licence and a
 * build warning, since there is nothing else to reproduce.
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
 * is among the ones that travel.
 */
const VIRTUAL_PACKAGES: readonly (readonly [prefix: string, name: string])[] = [
  [`${VIRTUAL}vite/`, 'vite'],
  [`${VIRTUAL}rolldown/`, 'rolldown'],
]

const NODE_MODULES = '/node_modules/'

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
 * itself and not its parent, and tolerates Windows separators and a `?query` suffix.
 */
export const packageOfModule = (moduleId: string): PackageLocation | undefined => {
  const path = (moduleId.startsWith(VIRTUAL) ? moduleId.slice(1) : moduleId)
    .replace(/[?#].*$/, '')
    .replaceAll('\\', '/')
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

/** Every package whose code is in the given modules, once each, in a stable order. */
export const bundledPackages = (
  moduleIds: Iterable<string>,
  root: string,
): readonly PackageLocation[] => {
  const found = new Map<string, PackageLocation>()
  for (const id of moduleIds) {
    let location = packageOfModule(id)
    if (location === undefined) {
      const virtual = VIRTUAL_PACKAGES.find(([prefix]) => id.startsWith(prefix))
      const dir = virtual === undefined ? undefined : installedPackage(root, virtual[1])
      if (virtual !== undefined && dir !== undefined) {
        location = { name: virtual[1], dir, inlined: true }
      }
    }
    if (location !== undefined) found.set(location.dir, location)
  }
  return [...found.values()].sort((a, b) => a.dir.localeCompare(b.dir))
}

export interface PackageNotice {
  readonly name: string
  readonly version: string
  /** The SPDX string the package declares, if it declares one. */
  readonly license: string | undefined
  readonly homepage: string | undefined
  /** The package's own licence and notice files, verbatim. Empty if it ships none. */
  readonly texts: readonly string[]
}

/** `LICENSE`, `LICENSE.md`, `LICENSE-MIT`, `COPYING`, `NOTICE`: not `license.d.ts`. */
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[-._][\w.-]*)?$/i
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

/** The notice of one installed package. Throws if there is nothing to reproduce at all. */
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

  const texts = readdirSync(location.dir, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && LICENSE_FILE.test(entry.name) && !NOT_TEXT.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .map((name) => readFileSync(join(location.dir, name), 'utf8').replaceAll('\r\n', '\n').trim())
    .map((text) => (location.inlined === true ? ownLicence(text) : text))
    .filter((text) => text !== '')

  const license = licenseOf(manifest)
  if (texts.length === 0 && license === undefined) {
    throw new Error(
      `third-party notices: ${location.name} is in the bundle and ships no licence file and ` +
        `declares no licence; there is no notice to reproduce`,
    )
  }
  return {
    name: asText(manifest['name']) ?? location.name,
    version: asText(manifest['version']) ?? 'unknown',
    license,
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
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  )
  const blocks = ordered.map((notice) =>
    [
      RULE,
      `${notice.name} ${notice.version}`,
      ...(notice.license === undefined ? [] : [`Licence: ${notice.license}`]),
      ...(notice.homepage === undefined ? [] : [notice.homepage]),
      '',
      notice.texts.length > 0
        ? notice.texts.join('\n\n')
        : `This package ships no licence file; it declares ${notice.license ?? 'no licence'}.`,
    ].join('\n'),
  )
  return `${[HEADER, ...blocks].join('\n\n')}\n\n${RULE}\n`
}

export interface CollectedNotices {
  readonly text: string
  readonly warnings: readonly string[]
}

/**
 * The notices for the modules a build produced. Throws when none of them is a third-party
 * package, because a plugin that finds nothing has stopped working, not found nothing.
 */
export const collectNotices = (moduleIds: Iterable<string>, root: string): CollectedNotices => {
  const packages = bundledPackages(moduleIds, root)
  if (packages.length === 0) {
    throw new Error(
      'third-party notices: no third-party package was found among the bundled modules; ' +
        'the bundler output no longer looks the way this plugin reads it',
    )
  }
  const notices = packages.map(readNotice)
  const warnings = notices
    .filter((notice) => notice.texts.length === 0)
    .map((notice) => `${notice.name}@${notice.version} ships no licence file`)
  return { text: renderNotices(notices), warnings }
}

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
      const ids = new Set<string>()
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') for (const id of output.moduleIds) ids.add(id)
      }
      const { text, warnings } = collectNotices(ids, root)
      for (const warning of warnings) this.warn(warning)
      this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: text })
    },
  }
}
