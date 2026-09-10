import { createContext, useContext, type ReactNode } from 'react'
import type { Api } from '../lib/api/client'

/**
 * The typed API, injected.
 *
 * A feature component never imports `api` from `lib/api/client` directly: that import
 * is what makes a component untestable without a network, and it is why 1.0's upload
 * screen could only be exercised by starting a server. The real instance is wired once
 * in `main.tsx`; a test passes a fake through `renderWithProviders`.
 */
const ApiContext = createContext<Api | null>(null)

export interface ApiProviderProps {
  readonly api: Api
  readonly children: ReactNode
}

export function ApiProvider({ api, children }: ApiProviderProps) {
  // No memo: `api` is a stable object created once at the composition root, so the
  // context value only changes when the caller genuinely swaps the API.
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): Api {
  const api = useContext(ApiContext)
  if (api === null) {
    throw new Error(
      'useApi must be used inside an <ApiProvider>. Wrap the tree in main.tsx, or use renderWithProviders in a test.',
    )
  }
  return api
}
