import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import type { Event } from '../../../domain/events/event'
import { retentionApplies } from '../../../domain/events/eventStatus'
import { exportFolderName } from '../../../domain/exports/exportFolder'
import type { Slug } from '../../../domain/shared/slug'
import { addDays } from '../../../domain/shared/time'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'

/**
 * Which albums `npm run export` copies (spec 22, section 8).
 *
 * `--due-within N`: the albums whose deletion date falls **at most N days from now**, an album already
 * due included (it goes at the next purge, so it is the most urgent). It is `listDueForPurge` asked
 * with a clock moved N days on, the way the warning sweep asks it, so the deadline rule stays written
 * in the two places it already is: an album the operator holds, or that has no deadline, is never
 * listed. `--event <slug>` narrows to one album; alone it takes that album whatever its date, as
 * long as the evening is over.
 */

export interface AlbumToExport {
  readonly event: Event
  /** When the box will delete it, `null` when it has no date. */
  readonly deadline: Date | null
  /** The folder name under `--to`. */
  readonly folder: string
}

export type AlbumSelection =
  | { readonly kind: 'albums'; readonly albums: readonly AlbumToExport[] }
  | { readonly kind: 'unknownEvent'; readonly slug: string }
  | { readonly kind: 'notClosed'; readonly slug: string }

export interface SelectAlbumsDeps {
  readonly events: Pick<EventRepository, 'listDueForPurge' | 'findBySlug'>
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly clock: Clock
  readonly capNoticeDays: number
}

export type SelectAlbumsToExport = (criteria: {
  readonly dueWithinDays: number | null
  readonly slug: Slug | null
}) => Promise<AlbumSelection>

export const makeSelectAlbumsToExport =
  ({ events, clients, clock, capNoticeDays }: SelectAlbumsDeps): SelectAlbumsToExport =>
  async ({ dueWithinDays, slug }) => {
    const now = clock.now()

    let candidates: readonly Event[]
    if (dueWithinDays !== null) {
      candidates = await events.listDueForPurge(addDays(now, dueWithinDays), { capNoticeDays })
      if (slug !== null) candidates = candidates.filter((event) => event.slug.value === slug.value)
    } else if (slug !== null) {
      const found = await events.findBySlug(slug)
      if (found === null) return { kind: 'unknownEvent', slug: slug.value }
      if (!retentionApplies(found.status)) return { kind: 'notClosed', slug: slug.value }
      candidates = [found]
    } else {
      candidates = []
    }

    const albums: AlbumToExport[] = []
    for (const event of candidates) {
      const client = event.clientId === null ? null : await clients.findById(event.clientId)
      const deadline = purgeDeadline(event, client, capNoticeDays)
      albums.push({ event, deadline, folder: exportFolderName(event.slug.value, deadline, now) })
    }
    return { kind: 'albums', albums }
  }
