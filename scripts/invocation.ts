/**
 * How the person reading a command's output runs the next command.
 *
 * The same TypeScript runs two ways. From a source checkout, `npm run backup` hands it to
 * tsx. In the image there is no tsx, no `scripts/` directory and no npm script for these:
 * the operator runs what `tsconfig.ops.json` compiled, as `node dist/ops/scripts/…`.
 * Output that prints a follow-up command has to print the one that exists where the
 * reader is. `npm run restore -- <archive>`, printed inside the container, names a
 * command that cannot run there — which is the defect the compiled path exists to remove,
 * reproduced one line later in its own output.
 */
export type Invocation = 'npm' | 'node'

/**
 * Read from the name of the file being run: `.ts` under tsx, `.js` once compiled.
 *
 * Asked only at an entry point, of that entry point's own file. It is not worked out
 * inside `run`, because under vitest the process is the test runner and everything about
 * it describes the runner — which is why `run` takes the answer as a parameter.
 */
export const invocationOf = (entryFile: string): Invocation =>
  entryFile.endsWith('.js') ? 'node' : 'npm'

export type OperatorCommand = 'backup' | 'verify' | 'restore'

const AS_NPM: Readonly<Record<OperatorCommand, string>> = {
  backup: 'npm run backup',
  verify: 'npm run backup:verify',
  restore: 'npm run restore',
}

/** Relative to `/app`, the image's working directory, which is where `exec` and `run` start. */
const AS_NODE: Readonly<Record<OperatorCommand, string>> = {
  backup: 'node dist/ops/scripts/backup.js',
  verify: 'node dist/ops/scripts/backup.js --verify',
  restore: 'node dist/ops/scripts/restore.js',
}

/** `command` with `args`, written the way the reader would type it. */
export const commandLine = (
  invocation: Invocation,
  command: OperatorCommand,
  args = '',
): string => {
  if (invocation === 'node') return args === '' ? AS_NODE[command] : `${AS_NODE[command]} ${args}`
  // `--` is npm's, so that the arguments reach the script rather than npm itself.
  return args === '' ? AS_NPM[command] : `${AS_NPM[command]} -- ${args}`
}
