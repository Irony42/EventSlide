import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useQueueSelection } from './useQueueSelection'
import { aModerationPhoto } from '../../../testing/renderWithProviders'
import type { ModerationPhotoDto } from '../../../lib/api/dto'

const photos = (...ids: readonly string[]): readonly ModerationPhotoDto[] =>
  ids.map((id) => aModerationPhoto({ id }))

describe('useQueueSelection', () => {
  it('selects and deselects a photo', () => {
    const { result } = renderHook(() => useQueueSelection(photos('photo-1', 'photo-2')))

    act(() => result.current.toggle('photo-1'))
    expect(result.current.selectedIds).toEqual(['photo-1'])

    act(() => result.current.toggle('photo-1'))
    expect(result.current.selectedIds).toEqual([])
  })

  it('reports the selection in the order the photos are shown', () => {
    // The bulk endpoint is given this array; a host reading "2 photos" next to a queue
    // sorted oldest-first should not get a list in the order they happened to click.
    const { result } = renderHook(() => useQueueSelection(photos('photo-1', 'photo-2')))

    act(() => result.current.toggle('photo-2'))
    act(() => result.current.toggle('photo-1'))

    expect(result.current.selectedIds).toEqual(['photo-1', 'photo-2'])
  })

  it('selects and clears the whole queue', () => {
    const { result } = renderHook(() => useQueueSelection(photos('photo-1', 'photo-2')))

    act(() => result.current.selectAll())
    expect(result.current.selectedIds).toEqual(['photo-1', 'photo-2'])

    act(() => result.current.clear())
    expect(result.current.selectedIds).toEqual([])
  })

  it('drops a photo that has left the queue from the selection', () => {
    // Another moderator dealt with it, or the filter changed. A selection holding an id
    // that is no longer on screen would send it to the bulk endpoint unseen.
    const { result, rerender } = renderHook(
      (items: readonly ModerationPhotoDto[]) => useQueueSelection(items),
      { initialProps: photos('photo-1', 'photo-2') },
    )
    act(() => result.current.selectAll())

    rerender(photos('photo-2'))

    expect(result.current.selectedIds).toEqual(['photo-2'])
  })

  it('forgets the focused photo once it is no longer in the queue', () => {
    const { result, rerender } = renderHook(
      (items: readonly ModerationPhotoDto[]) => useQueueSelection(items),
      { initialProps: photos('photo-1', 'photo-2') },
    )
    act(() => result.current.focus('photo-1'))

    rerender(photos('photo-2'))

    expect(result.current.focusedId).toBeNull()
  })

  it('starts at the top of the queue on the first move down', () => {
    const { result } = renderHook(() => useQueueSelection(photos('photo-1', 'photo-2')))

    act(() => result.current.moveFocus(1))

    expect(result.current.focusedId).toBe('photo-1')
  })

  it('starts at the bottom of the queue on the first move up', () => {
    const { result } = renderHook(() => useQueueSelection(photos('photo-1', 'photo-2')))

    act(() => result.current.moveFocus(-1))

    expect(result.current.focusedId).toBe('photo-2')
  })

  it('stops at the end of the queue instead of wrapping around', () => {
    // A host holding J expects to arrive at the last photo, not to be sent back to one
    // they have already decided on.
    const { result } = renderHook(() => useQueueSelection(photos('photo-1', 'photo-2')))

    act(() => result.current.focus('photo-2'))
    act(() => result.current.moveFocus(1))

    expect(result.current.focusedId).toBe('photo-2')
  })

  it('moves nothing in an empty queue', () => {
    const { result } = renderHook(() => useQueueSelection([]))

    act(() => result.current.moveFocus(1))

    expect(result.current.focusedId).toBeNull()
  })

  it('puts the browser focus on the photo it moves to', () => {
    const element = document.createElement('article')
    element.tabIndex = -1
    document.body.append(element)
    const { result } = renderHook(() => useQueueSelection(photos('photo-1')))
    act(() => result.current.registerCard('photo-1', element))

    act(() => result.current.moveFocus(1))

    expect(element).toHaveFocus()
    element.remove()
  })

  it('leaves the browser focus alone when asked to, so a modal keeps it', () => {
    const element = document.createElement('article')
    element.tabIndex = -1
    document.body.append(element)
    const { result } = renderHook(() => useQueueSelection(photos('photo-1')))
    act(() => result.current.registerCard('photo-1', element))

    act(() => result.current.moveFocus(1, { moveDomFocus: false }))

    expect(result.current.focusedId).toBe('photo-1')
    expect(element).not.toHaveFocus()
    element.remove()
  })

  it('forgets a tile that has unmounted', () => {
    const element = document.createElement('article')
    element.tabIndex = -1
    document.body.append(element)
    const { result } = renderHook(() => useQueueSelection(photos('photo-1')))
    act(() => result.current.registerCard('photo-1', element))
    act(() => result.current.registerCard('photo-1', null))

    // No throw, and nothing focused: the element is gone from the document as far as
    // the queue is concerned.
    act(() => result.current.focus('photo-1'))

    expect(element).not.toHaveFocus()
    expect(result.current.isSelected('photo-1')).toBe(false)
    element.remove()
  })
})
