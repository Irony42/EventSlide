import { useCallback, useMemo } from 'react'
import { useApi } from '../../../app/useApi'
import { useLoader } from '../adminShared'

/**
 * The names of the box's clients, by id, read from the listing (`GET /api/site/clients`).
 *
 * The audit log and the account listing hold ids; a name is what an operator recognises a client
 * by. **A listing that cannot be read leaves the map empty**, and the caller falls back to the id:
 * a screen about something else must not fail because a label could not be fetched. The first two
 * hundred are asked for, which is the listing's own ceiling.
 */
export const useClientNames = (): ReadonlyMap<string, string> => {
  const api = useApi()
  const load = useCallback(
    async (signal: AbortSignal) => (await api.siteClients({ limit: 200 }, signal)).items,
    [api],
  )
  const { data: clients } = useLoader(load)
  return useMemo(
    () => new Map((clients ?? []).map((client) => [client.id, client.name] as const)),
    [clients],
  )
}
