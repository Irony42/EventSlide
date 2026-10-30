import type {
  SiteEventState,
  SitePhotoState,
} from '../../../application/usecases/site/takedownState'
import type { SiteEventLookupDto, SiteEventStateDto, SitePhotoStateDto } from './dto'

const isoOrNull = (at: Date | null): string | null => (at === null ? null : at.toISOString())

/** Field by field, so a field a state grows later reaches the operator only when somebody decides it. */
export const toSiteEventStateDto = (state: SiteEventState): SiteEventStateDto => ({
  id: state.id,
  clientId: state.clientId,
  status: state.status,
  createdAt: state.createdAt.toISOString(),
  takenDownAt: isoOrNull(state.takenDownAt),
  purgeHeldAt: isoOrNull(state.purgeHeldAt),
})

export const toSiteEventLookupDto = (states: readonly SiteEventState[]): SiteEventLookupDto => ({
  items: states.map(toSiteEventStateDto),
})

export const toSitePhotoStateDto = (state: SitePhotoState): SitePhotoStateDto => ({
  id: state.id,
  eventId: state.eventId,
  takenDownAt: isoOrNull(state.takenDownAt),
})
