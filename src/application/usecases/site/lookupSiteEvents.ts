import { DomainError } from '../../../domain/shared/errors'
import { JoinCode } from '../../../domain/shared/joinCode'
import { err, ok, type Result } from '../../../domain/shared/result'
import { Slug } from '../../../domain/shared/slug'
import type { Event } from '../../../domain/events/event'
import type { EventRepository } from '../../ports/eventRepository'
import { siteEventStateOf, type SiteEventState } from './takedownState'

/**
 * Which event is this? (`GET /api/site/events/lookup?q=`; launch review S5.) The operator is given
 * a slug, a join code, an address or a name by a report, and needs the **id** the takedown routes
 * take, without the console having to show anybody an event's name.
 *
 * It tries, stopping at the first that finds something: an address pasted whole (`.../e/<slug>`,
 * `.../events/<slug>`, `.../join/<code>`, whose slug or code is then read as below), a slug, a
 * join code, and an **exact** name (case-insensitive: a name is what a report quotes, and a prefix or
 * a substring would turn the lookup into a way to browse what clients called their events). At most
 * {@link LOOKUP_LIMIT} events answer, and an answer is {@link SiteEventState}: ids, a status and
 * two instants, never the name, the slug or the code that matched.
 */

export const LOOKUP_LIMIT = 20

/** The longest query worth reading: an event name is 80 characters, an address a few more. */
export const LOOKUP_MAX_LENGTH = 300

export interface LookupSiteEventsInput {
  readonly query: string
}

export interface LookupSiteEventsDeps {
  readonly events: Pick<EventRepository, 'findBySlug' | 'findByJoinCode' | 'listByName'>
}

export type LookupSiteEvents = (
  input: LookupSiteEventsInput,
) => Promise<Result<readonly SiteEventState[], DomainError>>

/** The slug or code in an address, or `null` when the text is not one. */
const fromAddress = (text: string): string | null => {
  const found = /\/(?:e|events|join)\/([A-Za-z0-9-]+)/.exec(text)
  return found?.[1] ?? null
}

export const makeLookupSiteEvents =
  ({ events }: LookupSiteEventsDeps): LookupSiteEvents =>
  async ({ query }) => {
    const text = query.trim()
    if (text.length === 0 || text.length > LOOKUP_MAX_LENGTH) {
      return err(DomainError.invalid('siteLookup.queryInvalid', { max: LOOKUP_MAX_LENGTH }))
    }

    const candidate = fromAddress(text) ?? text
    const slug = Slug.create(candidate.toLowerCase())
    const bySlug: Event | null = slug.ok ? await events.findBySlug(slug.value) : null
    if (bySlug !== null) return ok([siteEventStateOf(bySlug)])

    const code = JoinCode.create(candidate)
    const byCode: Event | null = code.ok ? await events.findByJoinCode(code.value) : null
    if (byCode !== null) return ok([siteEventStateOf(byCode)])

    const named = await events.listByName(text, LOOKUP_LIMIT)
    return ok(named.map(siteEventStateOf))
  }
