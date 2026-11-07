import { describe, expect, it } from 'vitest'
import { eventSettings } from '../../testing/renderWithProviders'
import { wallChanges } from './wallDisplayOptions'

type Wall = ReturnType<typeof eventSettings>['wall']

/** A value different from the loaded one, of the same kind. */
const flipped = (value: Wall[keyof Wall]): unknown => {
  if (typeof value === 'boolean') return !value
  if (typeof value === 'number') return value + 1
  if (value === null) return 'spotlight'
  return `${value}-other`
}

describe('wallChanges', () => {
  const loaded = eventSettings().wall
  const keys = Object.keys(loaded) as (keyof Wall)[]

  it('compares at least the sixteen settings of the wall group', () => {
    // A fixture that lost keys would turn the table below into a smaller promise.
    expect(keys).toHaveLength(16)
  })

  it.each(keys)('sends exactly %s when it is the only setting that moved (WEB-HOST-07)', (key) => {
    const draft = { ...loaded, [key]: flipped(loaded[key]) }

    expect(wallChanges(draft, loaded)).toEqual({ [key]: draft[key] })
  })

  it('sends nothing when the draft equals what the page loaded', () => {
    expect(wallChanges({ ...loaded }, loaded)).toBeUndefined()
  })

  it('sends only the keys that moved when several did', () => {
    const draft = { ...loaded, tilt: !loaded.tilt, qrScale: loaded.qrScale + 0.1 }

    expect(wallChanges(draft, loaded)).toEqual({ tilt: draft.tilt, qrScale: draft.qrScale })
  })
})
