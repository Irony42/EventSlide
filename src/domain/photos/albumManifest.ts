/**
 * `MANIFEST.sha256`, the last file of a host's album ZIP (spec 22): one line per file, in the
 * format `sha256sum -c` reads (`<64 hex>  <name>`, two spaces), the names relative to the
 * manifest's own folder. The host can check the archive at home, with the tool their system
 * already has and without trusting us.
 *
 * What it adds on top of the format is one comment line, **`# missing: N`**: the number of rows the
 * album listed whose file was not on the disk and which the archive therefore does not carry. A
 * ZIP that is missing photographs and says nothing is the failure this file exists to make visible.
 * `sha256sum` ignores a line that starts with `#`.
 */

export interface ManifestLine {
  /** Lowercase hex, 64 characters. */
  readonly digest: string
  /** The entry's name as it is read from the manifest's folder: never a path with a slash. */
  readonly name: string
}

export const MANIFEST_NAME = 'MANIFEST.sha256'

export const renderManifest = (lines: readonly ManifestLine[], missing: number): string =>
  [...lines.map((line) => `${line.digest}  ${line.name}`), `# missing: ${missing}`].join('\n') + '\n'
