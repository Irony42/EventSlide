import { useMemo, useState, type ReactNode } from 'react'
import { PendingSignupsContext } from './pendingSignupsContext'

/** Holds the counter the badge and the page share (see `pendingSignupsContext.ts`). */
export function PendingSignupsProvider({ children }: { readonly children: ReactNode }) {
  const [stamp, setStamp] = useState(0)
  const value = useMemo(
    () => ({ stamp, refresh: () => setStamp((current) => current + 1) }),
    [stamp],
  )
  return <PendingSignupsContext.Provider value={value}>{children}</PendingSignupsContext.Provider>
}
