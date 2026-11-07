/**
 * The wire format, transcribed from docs/API.md.
 *
 * Deliberately duplicated rather than imported from `src/`: the web app talks to the
 * server over HTTP only, so the DTO is an explicit contract. Sharing the server's
 * types would make every internal rename a silently breaking API change, and lint
 * forbids the import.
 */

export * from './dto/account'
export * from './dto/common'
export * from './dto/gallery'
export * from './dto/guest'
export * from './dto/host'
export * from './dto/site'
export * from './dto/wall'
