import type { AlbumExport } from '../../../domain/exports/albumExport'
import { isExportExpired } from '../../../domain/exports/exportExpiry'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AlbumExportRepository } from '../../ports/albumExportRepository'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import { checkExportAccess } from './exportAccess'

/**
 * The state of the event's archive for the host's screen: the row, or `null` when none was ever
 * asked for. Reads one row and writes nothing, and answers by the same rule as the streamed ZIP
 * (`exportAllowed`: taken down is `404`, a suspended client without an offboarding `403`).
 *
 * **A sealed archive past its expiry is `null`**: the sweep may not have run yet, and a host must
 * not be shown "ready" for a file the download would refuse. Nothing is said of a purge hold.
 */

export interface GetAlbumExportDeps {
  readonly events: EventRepository
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly exports: Pick<AlbumExportRepository, 'find'>
  readonly clock: Clock
}

export type GetAlbumExport = (input: {
  readonly eventId: EventId
}) => Promise<Result<AlbumExport | null, DomainError>>

export const makeGetAlbumExport =
  ({ events, clients, exports, clock }: GetAlbumExportDeps): GetAlbumExport =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const allowed = await checkExportAccess(clients, event)
    if (!allowed.ok) return allowed

    const archive = await exports.find(eventId)
    if (
      archive !== null &&
      archive.status === 'sealed' &&
      archive.expiresAt !== null &&
      isExportExpired(archive.expiresAt, clock.now())
    ) {
      return ok(null)
    }
    return ok(archive)
  }
