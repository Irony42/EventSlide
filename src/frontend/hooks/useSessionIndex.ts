import { useCallback, useState } from 'react'

export const useSessionIndex = (storageKey: string) => {
  const [index, setIndex] = useState<number>(() => Number(sessionStorage.getItem(storageKey) || 0))

  const updateIndex = useCallback(
    (nextIndex: number) => {
      setIndex(nextIndex)
      sessionStorage.setItem(storageKey, String(nextIndex))
    },
    [storageKey]
  )

  const resetIndex = useCallback(() => updateIndex(0), [updateIndex])

  return { index, updateIndex, resetIndex }
}
