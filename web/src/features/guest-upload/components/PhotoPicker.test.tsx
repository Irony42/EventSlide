import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PhotoPicker } from './PhotoPicker'
import { fr } from '../../../lib/i18n/fr'

/**
 * The two ways a photo gets into the queue, from the guest's side of the phone.
 *
 * `GuestUploadPage.test.tsx` covers picking photos and seeing them queue. What is left
 * here is the change events a picker fires when the guest does *not* pick anything —
 * the common case, because a picker is opened and closed by mistake constantly on a
 * phone, and each of those must not reach the queue.
 */

const libraryInput = (): HTMLInputElement => {
  const input = screen.getByTestId('photo-input')
  if (!(input instanceof HTMLInputElement)) throw new Error('the picker rendered no file input')
  return input
}

describe('PhotoPicker', () => {
  it('leaves the real file input in the tab order, so a keyboard can open it', () => {
    // 1.0 used a <div onClick> calling input.click(): unreachable by keyboard and
    // invisible to a screen reader.
    render(<PhotoPicker onPick={vi.fn()} />)

    expect(screen.getByLabelText(fr.upload.addPhotos)).toBe(libraryInput())
    expect(libraryInput()).not.toHaveAttribute('tabindex', '-1')
  })

  it('queues nothing when the guest opens the picker and closes it again', () => {
    const onPick = vi.fn()
    render(<PhotoPicker onPick={onPick} />)

    fireEvent.change(libraryInput(), { target: { files: [] } })

    expect(onPick).not.toHaveBeenCalled()
  })

  it('ignores a change event from a browser that reports no file list', () => {
    // `files` is nullable in the DOM spec, and some in-app browsers — the ones a guest
    // reaches this page through after scanning a QR code from a message — do report it
    // as null. A crash here costs the photo.
    const onPick = vi.fn()
    render(<PhotoPicker onPick={onPick} />)

    fireEvent.change(libraryInput(), { target: { files: null } })

    expect(onPick).not.toHaveBeenCalled()
  })

  it('clears the input so the same photo can be picked again after a mistake', () => {
    // Without this, re-selecting a photo the guest removed by mistake fires no change
    // event at all and the photo simply cannot be sent.
    const onPick = vi.fn()
    render(<PhotoPicker onPick={onPick} />)
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'confettis.jpg', {
      type: 'image/jpeg',
    })

    fireEvent.change(libraryInput(), { target: { files: [file] } })

    expect(onPick).toHaveBeenCalledWith([file])
    expect(libraryInput().value).toBe('')
  })
})
