import { makeBuildNextAlbumExport } from '../application/usecases/exports/buildNextAlbumExport'
import { makeRecoverAlbumExports } from '../application/usecases/exports/recoverAlbumExports'
import { makeSweepAlbumExports } from '../application/usecases/exports/sweepAlbumExports'
import type { Adapters } from './usecases'

type BuildNextDeps = Parameters<typeof makeBuildNextAlbumExport>[0]

/** What the archive worker needs beyond the adapters: values only the container can supply. */
export interface ExportWorkerWiring {
  readonly policy: BuildNextDeps['policy']
  readonly freeDiskBytes: BuildNextDeps['freeDiskBytes']
  /** The mail that tells the host an archive is ready (spec 32, A2). */
  readonly onFinished?: BuildNextDeps['onFinished']
}

/**
 * The three use cases the archive worker drives (spec 22), built like every other slice:
 * composition only. They are not on the HTTP bag, because no route calls them; the worker is their
 * one caller, and exists only when the function is on.
 */
export const exportWorkerUseCases = (adapters: Adapters, wiring: ExportWorkerWiring) => ({
  buildNextAlbumExport: makeBuildNextAlbumExport({
    events: adapters.events,
    clients: adapters.clients,
    guests: adapters.guests,
    guestbook: adapters.guestbook,
    voices: adapters.voices,
    photos: adapters.photos,
    media: adapters.media,
    archive: adapters.archive,
    streamHasher: adapters.streamHasher,
    exports: adapters.exports,
    exportFiles: adapters.exportFiles,
    clips: adapters.clips,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: wiring.policy,
    freeDiskBytes: wiring.freeDiskBytes,
    ...(wiring.onFinished === undefined ? {} : { onFinished: wiring.onFinished }),
  }),
  recoverAlbumExports: makeRecoverAlbumExports({
    exports: adapters.exports,
    logger: adapters.logger,
  }),
  sweepAlbumExports: makeSweepAlbumExports({
    exports: adapters.exports,
    exportFiles: adapters.exportFiles,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
  }),
})
