import { DomainError } from '../shared/errors'
import { allowsAnotherPhoto, fitsInQuota, remainingQuota } from './quota'

/**
 * The order in which ingest refuses, and what it says, written once.
 *
 * A write is refused by the first of three ceilings it reaches: the author's own photo cap,
 * then the event's byte quota, then the client's byte ceiling over all its events. The event's
 * own quota is named before the client's because it is the one a host can act on, so an event
 * that reaches both is told about its own. That order is a product rule, and it used to be
 * written four times — in the in-memory fake and in the SQLite adapter, for photos and again
 * for clips — kept equal only by the shared contract. The repositories now compute their sums
 * and apply the verdicts; the decision is here.
 */

/** The event's quota, or the client's ceiling, was reached. `remaining` is in bytes. */
export type StorageRefusal =
  | { readonly reason: 'quotaExceeded'; readonly remaining: number }
  | { readonly reason: 'clientStorageFull'; readonly remaining: number }

/** `already` is how many photos the author held when the cap refused this one. */
export interface PhotoCapRefusal {
  readonly reason: 'photoLimitReached'
  readonly already: number
}

export interface EventStorage {
  readonly quotaBytes: number
  readonly usedBytes: number
}

export interface ClientStorage {
  readonly maxBytes: number
  readonly usedBytes: number
}

/**
 * Whether `additionalBytes` still fit, and if not which ceiling said so: the event's quota
 * first, then the client's. `client` is `null` for an event with no client, or a client with
 * no byte ceiling.
 */
export const storageRefusalFor = (
  additionalBytes: number,
  event: EventStorage,
  client: ClientStorage | null,
): StorageRefusal | null => {
  if (!fitsInQuota(event.quotaBytes, event.usedBytes, additionalBytes)) {
    return { reason: 'quotaExceeded', remaining: remainingQuota(event.quotaBytes, event.usedBytes) }
  }

  if (client !== null && !fitsInQuota(client.maxBytes, client.usedBytes, additionalBytes)) {
    return {
      reason: 'clientStorageFull',
      remaining: remainingQuota(client.maxBytes, client.usedBytes),
    }
  }

  return null
}

/**
 * The verdict on one photo: the author's cap first, then {@link storageRefusalFor}.
 *
 * `heldByAuthor` is how many photos the author already holds, or `null` for a host, to whom
 * the cap never applies.
 */
export const photoRefusalFor = (
  photo: { readonly byteSize: number; readonly heldByAuthor: number | null },
  maxPhotosPerGuest: number | null,
  event: EventStorage,
  client: ClientStorage | null,
): PhotoCapRefusal | StorageRefusal | null => {
  if (photo.heldByAuthor !== null && !allowsAnotherPhoto(maxPhotosPerGuest, photo.heldByAuthor)) {
    return { reason: 'photoLimitReached', already: photo.heldByAuthor }
  }

  return storageRefusalFor(photo.byteSize, event, client)
}

/**
 * What a refusal at the door is answered with: the codes the wire carries, written once so the
 * photo and clip paths cannot drift.
 *
 * `quotaExceeded` names what the event has left; `clientStorageFull` deliberately does not, since
 * it is what the client's **other** events have left too and a guest of one event has no business
 * reading how full its neighbours are.
 */
export const admissionRefusalError = (
  refusal: PhotoCapRefusal | StorageRefusal,
  requiredBytes: number,
): DomainError => {
  switch (refusal.reason) {
    case 'quotaExceeded':
      return DomainError.quotaExceeded('event.quotaExceeded', {
        remaining: refusal.remaining,
        required: requiredBytes,
      })
    case 'clientStorageFull':
      return DomainError.quotaExceeded('client.storageFull', { required: requiredBytes })
    case 'photoLimitReached':
      return DomainError.quotaExceeded('event.photoLimitReached', { already: refusal.already })
  }
}
