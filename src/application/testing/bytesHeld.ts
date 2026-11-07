import type { MediaStore } from '../ports/mediaStore'
import type { EventId } from '../../domain/shared/ids'

/**
 * What a media store holds for one event, in bytes: the sum of what `list` names.
 *
 * The production code never asks a store for this figure (the database sum is the admission
 * figure), so it is not a port method. Tests that check "the bytes were removed" or "the bytes
 * were kept" read it through the one enumeration the port does have.
 */
export const bytesHeld = async (store: MediaStore, eventId: EventId): Promise<number> =>
  (await store.list(eventId)).reduce((total, object) => total + object.byteSize, 0)
