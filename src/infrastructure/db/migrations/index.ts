import type { Migration } from '../migrator'
import { migration001 } from './001_initial_schema'
import { migration002 } from './002_event_scheduled_open_close'
import { migration003 } from './003_clips'

/**
 * The ordering contract, written out rather than globbed.
 *
 * A directory listing is not a guarantee: it changes with the filesystem, and a build
 * step that bundles the server would not see the files at all. Adding a migration means
 * adding a line here.
 */
export const migrations: readonly Migration[] = [migration001, migration002, migration003]
