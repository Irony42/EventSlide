import { makeBuildNextAlbumBook } from '../application/usecases/book/buildNextAlbumBook'
import { makeRecoverAlbumBooks } from '../application/usecases/book/recoverAlbumBooks'
import { makeSweepAlbumBooks } from '../application/usecases/book/sweepAlbumBooks'
import type { Adapters } from './usecases'

type BuildNextDeps = Parameters<typeof makeBuildNextAlbumBook>[0]

/** What the book worker needs beyond the adapters: values only the container can supply. */
export interface BookWorkerWiring {
  readonly policy: BuildNextDeps['policy']
  readonly renderer: BuildNextDeps['renderer']
  readonly diskHasRoom: BuildNextDeps['diskHasRoom']
}

/**
 * The three use cases the photo-book worker drives (spec 04), built like every other slice:
 * composition only. They are not on the HTTP bag, because no route calls them; the worker
 * is their one caller, and exists only when the function is on.
 */
export const bookWorkerUseCases = (adapters: Adapters, wiring: BookWorkerWiring) => ({
  buildNextAlbumBook: makeBuildNextAlbumBook({
    events: adapters.events,
    clients: adapters.clients,
    guests: adapters.guests,
    photos: adapters.photos,
    media: adapters.media,
    books: adapters.books,
    bookFiles: adapters.bookFiles,
    renderer: wiring.renderer,
    clips: adapters.clips,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
    policy: wiring.policy,
    diskHasRoom: wiring.diskHasRoom,
  }),
  recoverAlbumBooks: makeRecoverAlbumBooks({ books: adapters.books, logger: adapters.logger }),
  sweepAlbumBooks: makeSweepAlbumBooks({
    books: adapters.books,
    bookFiles: adapters.bookFiles,
    bus: adapters.bus,
    clock: adapters.clock,
    logger: adapters.logger,
  }),
})
