import { describe, expect, it } from 'vitest'
import { acceptsGuests, isMutable } from '../../../domain/events/eventStatus'
import type { EventStatus } from '../../../domain/events/eventStatus'

/**
 * The print page's availability by status, held against the domain it transcribes.
 *
 * `web/src/features/admin/print/printKit.ts` decides which statuses print and which print
 * with a notice; the web may not import the domain, so the rule is copied and this test fails
 * if the lifecycle moves. Loaded by path (not an import of the web app from the server's
 * build), as the other contract tests read the stylesheet by path.
 */
const MODULE = '../../../../web/src/features/admin/print/printKit'

type Availability = 'ready' | 'draft' | 'closed' | 'unavailable'

const load = async (): Promise<(status: EventStatus) => Availability> => {
  const loaded = (await import(/* @vite-ignore */ MODULE)) as {
    availabilityOf: (status: EventStatus) => Availability
  }
  return loaded.availabilityOf
}

const STATUSES: readonly EventStatus[] = ['draft', 'live', 'closed', 'archived']

describe('printKit availability against the event lifecycle', () => {
  it('prints exactly the statuses the domain still lets the host mutate', async () => {
    const availabilityOf = await load()
    for (const status of STATUSES) {
      expect(availabilityOf(status) !== 'unavailable', status).toBe(isMutable(status))
    }
  })

  it('warns exactly when the domain would refuse the guest who scans', async () => {
    const availabilityOf = await load()
    for (const status of STATUSES) {
      const printable = availabilityOf(status) !== 'unavailable'
      expect(availabilityOf(status) === 'ready', status).toBe(printable && acceptsGuests(status))
    }
  })
})
