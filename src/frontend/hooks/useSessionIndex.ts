import { useCallback, useState } from 'react'

export const useSessionIndex = (storageKey: string) => {
  const [index, setIndex] = useState<number>(() => Number(sessionStorage.getItem(storageKey) || 0))

  const updateIndex = useCallback(
    (nextIndex: number | ((prev: number) => number)) => {
      setIndex((prev) => {
        const newVal = typeof nextIndex === 'function' ? nextIndex(prev) : nextIndex
        sessionStorage.setItem(storageKey, String(newVal))
        return newVal
      })
    },
    [storageKey]
  )

  const resetIndex = useCallback(() => updateIndex(0), [updateIndex])

  return { index, updateIndex, resetIndex }
}
