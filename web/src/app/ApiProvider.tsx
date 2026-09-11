import type { ReactNode } from 'react'
import type { Api } from '../lib/api/client'
import { ApiContext } from './apiContext'

export interface ApiProviderProps {
  readonly api: Api
  readonly children: ReactNode
}

/**
 * Injects the typed API into the tree. `useApi` (in `./useApi`) reads it back out.
 */
export function ApiProvider({ api, children }: ApiProviderProps) {
  // No memo: `api` is a stable object created once at the composition root, so the
  // context value only changes when the caller genuinely swaps the API.
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}
