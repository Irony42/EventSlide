import { createContext } from 'react'
import type { Api } from '../lib/api/client'

/**
 * The typed API, injected.
 *
 * A feature component never imports `api` from `lib/api/client` directly: that import
 * is what makes a component untestable without a network, and it is why 1.0's upload
 * screen could only be exercised by starting a server. The real instance is wired once
 * in `main.tsx`; a test passes a fake through `renderWithProviders`.
 *
 * The context lives in its own module so that `ApiProvider.tsx` exports a component and
 * nothing else, which is what keeps Fast Refresh working for that file.
 */
export const ApiContext = createContext<Api | null>(null)
