import { createContext, useContext } from 'react'

/**
 * What the console's "Signups" badge and the page behind it share: a counter that says "ask the
 * server again how many requests wait". The layout owns it, a page that approved or refused one
 * bumps it, and the badge reads again.
 *
 * The context lives in its own module so that the files holding components export nothing else
 * (Fast Refresh).
 */
export interface PendingSignups {
  readonly stamp: number
  readonly refresh: () => void
}

export const PendingSignupsContext = createContext<PendingSignups | null>(null)

const NOTHING: PendingSignups = { stamp: 0, refresh: () => undefined }

/** Outside the console (a page mounted on its own in a test) there is no badge to refresh. */
export const usePendingSignups = (): PendingSignups => useContext(PendingSignupsContext) ?? NOTHING
