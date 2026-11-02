import type { NewClientDefaults } from '../../../domain/clients/newClientCeilings'
import type { ClientDefaultsDto } from './dto'

/**
 * The defaults for a new client, as the operator's console reads them (G2-18).
 *
 * Written field by field rather than spread, so a field added to `NewClientDefaults` is a
 * decision made here and in the contract in docs/API.md, and not a key that starts
 * appearing on the wire by accident.
 */
export const toClientDefaultsDto = (defaults: NewClientDefaults): ClientDefaultsDto => ({
  ceilings: {
    maxEvents: defaults.maxEvents,
    maxEventsPerPeriod: defaults.maxEventsPerPeriod,
    maxTotalBytes: defaults.maxTotalBytes,
    maxEventQuotaBytes: defaults.maxEventQuotaBytes,
    maxRetentionDays: defaults.maxRetentionDays,
    maxLiveDays: defaults.maxLiveDays,
    clipsAllowed: defaults.clipsAllowed,
    booksAllowed: defaults.booksAllowed,
  },
})
