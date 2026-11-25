import { createContext, useContext, useState } from 'react'

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

/**
 * What a panel was in the middle of, kept by the page: a question being written, the menus being
 * typed, a limit being set. The panel is drawn again each time it is opened (the column and the
 * preview change under it), and a half-written question must not go with it.
 */
export interface KeptState {
  readonly get: (key: string) => unknown
  readonly set: (key: string, value: unknown) => void
}

export const KeptStateContext = createContext<KeptState | null>(null)
export const KeptStateProvider = KeptStateContext.Provider

/** The state behind {@link KeptStateProvider}. */
export const useKeptStore = (): KeptState => {
  const [store, setStore] = useState<Readonly<Record<string, unknown>>>({})
  return {
    get: (key) => store[key],
    set: (key, value) => setStore((current) => ({ ...current, [key]: value })),
  }
}

/** `useState` that lives in the page's memory when there is one (a panel's draft), here otherwise. */
export const useKept = <T>(key: string, initial: T): readonly [T, (value: T) => void] => {
  const memory = useContext(KeptStateContext)
  const [local, setLocal] = useState<T>(initial)
  if (memory === null) return [local, setLocal]
  const kept = memory.get(key)
  return [kept === undefined ? initial : (kept as T), (value) => memory.set(key, value)]
}
