import { maintenanceSchema, serverSchema } from './schema'
import type { AppConfig } from './appConfig'
import { load, type Source } from './load'
export { ConfigError, resolveSourceUrl } from './load'
export type { AppConfig } from './appConfig'
export type { RawConfig } from './schema'

/**
 * The only module in the codebase that reads `process.env`. Lint enforces that
 * everywhere else, and the reason is that 1.0 read the environment inline at module
 * load in `src/index.ts`, so a missing variable produced a runtime surprise at the
 * first request rather than a refusal to boot.
 *
 * Everything is parsed and validated once. Failure is fatal and the message names
 * every problem at once, because discovering misconfiguration one variable per restart
 * is miserable when you are setting up in a venue an hour before the guests arrive.
 */

/**
 * Parse and validate, for a process that is going to serve requests. Throws
 * `ConfigError` listing every problem.
 *
 * `source` is a parameter so tests pass a plain object and never touch the real
 * environment.
 */
export const loadConfig = (source: Source = process.env): AppConfig => load(serverSchema, source)

/**
 * The same, for a command that opens the database and exits — `db:migrate`, `purge`,
 * `backup`, `restore`, `db:seed:demo`.
 *
 * One difference and it is written on `buildSchema` in `schema.ts`: the two secrets are not a
 * precondition, because nothing here signs anything. Every other refusal is identical,
 * `NODE_ENV` still defaults to `production`, and `isProduction` therefore still means what
 * it means everywhere else — which is what `seedDemo` needs it to mean.
 *
 * It is not a way to start a server without secrets. Absent ones are generated per boot,
 * so a server built on this config would mint sessions nothing else can verify and lose
 * every one of them on restart. `src/main/index.ts` calls `loadConfig`.
 */
export const loadMaintenanceConfig = (source: Source = process.env): AppConfig =>
  load(maintenanceSchema, source)
