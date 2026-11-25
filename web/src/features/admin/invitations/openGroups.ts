import { createContext, useState } from 'react'

/**
 * Which groups the host has opened, kept by the page: the left column is drawn again each time a
 * panel closes, and a group the host opened should still be open when they come back.
 */
export interface OpenGroups {
  readonly isOpen: (id: string) => boolean
  readonly setOpen: (id: string, open: boolean) => void
}

export const OpenGroupsContext = createContext<OpenGroups | null>(null)
export const OpenGroupsProvider = OpenGroupsContext.Provider

/** The state behind {@link OpenGroupsProvider}. */
export const useOpenGroups = (): OpenGroups => {
  const [open, setOpenState] = useState<Readonly<Record<string, boolean>>>({})
  return {
    isOpen: (id) => open[id] === true,
    setOpen: (id, value) => setOpenState((current) => ({ ...current, [id]: value })),
  }
}
