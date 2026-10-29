import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposerOptions } from './ComposerOptions'
import type { ClipUpload } from '../hooks/useClipUpload'
import { fr } from '../../../lib/i18n/fr'

/**
 * The caption and the video, folded under the pickers.
 *
 * `GuestUploadPage.test.tsx` covers what travels with the photos and the clip. What is here is
 * the arrangement: what is on screen before the guest has pressed anything, what a press does to
 * the page and to focus, and what may not be folded away.
 */

const LIMITS = { maxBytes: 80_000_000, maxSeconds: 15 }

const aClipUpload = (overrides: Partial<ClipUpload> = {}): ClipUpload => ({
  file: null,
  stage: 'idle',
  progress: 0,
  message: null,
  retryable: false,
  choose: vi.fn(),
  clear: vi.fn(),
  send: vi.fn(),
  cancel: vi.fn(),
  ...overrides,
})

interface HarnessProps {
  readonly captions?: boolean
  readonly clips?: boolean
  readonly initialCaption?: string
  readonly clip?: ClipUpload
}

/** The page owns the caption; this stands in for it, so typing is real. */
function Harness({
  captions = true,
  clips = true,
  initialCaption = '',
  clip = aClipUpload(),
}: HarnessProps) {
  const [caption, setCaption] = useState(initialCaption)
  return (
    <>
      <ComposerOptions
        captions={captions}
        caption={caption}
        onCaptionChange={setCaption}
        clips={clips}
        clip={clip}
        limits={LIMITS}
      />
      <button type="button">après</button>
    </>
  )
}

const captionButton = () => screen.getByRole('button', { name: fr.upload.captionLabel })
const clipButton = () => screen.getByRole('button', { name: fr.upload.clipSection })
const captionField = () => screen.getByLabelText(new RegExp(fr.upload.captionLabel))
const clipInput = () => screen.getByTestId('clip-input')

describe('ComposerOptions', () => {
  describe('before the guest has pressed anything', () => {
    it('shows both options as labelled buttons and neither control', () => {
      render(<Harness />)

      expect(captionButton()).toBeVisible()
      expect(clipButton()).toBeVisible()
      expect(captionButton()).toHaveAttribute('aria-expanded', 'false')
      expect(clipButton()).toHaveAttribute('aria-expanded', 'false')
      expect(captionField()).not.toBeVisible()
      expect(clipInput()).not.toBeVisible()
    })

    it('keeps the hints for the moment the control is on screen, not before', () => {
      render(<Harness />)

      expect(screen.getByText(fr.upload.captionHint(140))).not.toBeVisible()
      expect(screen.getByText(fr.upload.clipHint(15, 80))).not.toBeVisible()
    })

    it('points each button at the section that holds the control it reveals', () => {
      render(<Harness />)

      // `aria-controls` names the section the button unfolds, and that section holds the control.
      const captionPanel = document.getElementById(
        captionButton().getAttribute('aria-controls') ?? '',
      )
      const clipPanel = document.getElementById(clipButton().getAttribute('aria-controls') ?? '')

      expect(captionPanel).toContainElement(captionField())
      expect(clipPanel).toContainElement(clipInput())
    })
  })

  describe('the caption', () => {
    it('unfolds in place with its hint, reports it, and takes focus', async () => {
      render(<Harness />)

      await userEvent.click(captionButton())

      expect(captionButton()).toHaveAttribute('aria-expanded', 'true')
      expect(captionField()).toBeVisible()
      expect(screen.getByText(fr.upload.captionHint(140))).toBeVisible()
      expect(captionField()).toHaveFocus()
    })

    it('stays associated with its label once unfolded', async () => {
      render(<Harness />)

      await userEvent.click(captionButton())

      expect(captionField()).toHaveAccessibleName(new RegExp(fr.upload.captionLabel))
      expect(captionField()).toHaveAccessibleDescription(fr.upload.captionHint(140))
    })

    it('opens from the keyboard', async () => {
      render(<Harness />)

      captionButton().focus()
      await userEvent.keyboard('{Enter}')

      expect(captionField()).toBeVisible()
      expect(captionField()).toHaveFocus()
    })

    it('folds away again on a second press and leaves focus on the button', async () => {
      render(<Harness />)

      await userEvent.click(captionButton())
      await userEvent.click(captionButton())

      expect(captionButton()).toHaveAttribute('aria-expanded', 'false')
      expect(captionField()).not.toBeVisible()
      expect(captionButton()).toHaveFocus()
    })

    it('does not trap the keyboard: Tab leaves the field for whatever follows', async () => {
      render(<Harness clips={false} />)

      await userEvent.click(captionButton())
      await userEvent.tab()

      expect(screen.getByRole('button', { name: 'après' })).toHaveFocus()
    })

    it('is already unfolded when it holds text, with the text in it', () => {
      render(<Harness initialCaption="Les confettis" />)

      expect(captionButton()).toHaveAttribute('aria-expanded', 'true')
      expect(captionField()).toBeVisible()
      expect(captionField()).toHaveValue('Les confettis')
    })

    it('does not fold a caption that holds text, however often the button is pressed', async () => {
      render(<Harness initialCaption="Les confettis" />)

      await userEvent.click(captionButton())

      expect(captionButton()).toHaveAttribute('aria-expanded', 'true')
      expect(captionButton()).toHaveAttribute('aria-disabled', 'true')
      expect(captionField()).toBeVisible()
    })

    it('says plainly that the button can be pressed while the field is empty', async () => {
      render(<Harness />)

      expect(captionButton()).not.toHaveAttribute('aria-disabled')
      await userEvent.click(captionButton())
      expect(captionButton()).not.toHaveAttribute('aria-disabled')
    })

    it('keeps the field on screen when the guest deletes the last letter they typed', async () => {
      // Folding it then would take the field from under the cursor, with focus inside it.
      render(<Harness />)

      await userEvent.click(captionButton())
      await userEvent.keyboard('a{Backspace}')

      expect(captionField()).toHaveValue('')
      expect(captionField()).toBeVisible()
      expect(captionButton()).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('the video', () => {
    it('unfolds in place with its limits, reports it, and moves focus to the first picker', async () => {
      render(<Harness />)

      await userEvent.click(clipButton())

      expect(clipButton()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(fr.upload.clipHint(15, 80))).toBeVisible()
      expect(screen.getByText(fr.upload.recordClip)).toBeVisible()
      expect(clipInput()).toHaveFocus()
    })

    it('folds away again on a second press and leaves focus on the button', async () => {
      render(<Harness />)

      await userEvent.click(clipButton())
      await userEvent.click(clipButton())

      expect(clipButton()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText(fr.upload.clipHint(15, 80))).not.toBeVisible()
      expect(clipButton()).toHaveFocus()
    })

    it('names the section after its button, so the two are announced as one thing', () => {
      render(<Harness />)

      const section = document.getElementById(clipButton().getAttribute('aria-controls') ?? '')

      expect(section).toHaveAttribute('aria-labelledby', clipButton().id)
    })

    it.each(['ready', 'uploading', 'queued', 'running', 'done', 'waiting', 'failed'] as const)(
      'is unfolded, and stays so, while a clip is %s',
      async (stage) => {
        render(<Harness clip={aClipUpload({ stage, file: new File([], 'p.mp4') })} />)

        expect(clipButton()).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByTestId('clip-state')).toBeVisible()

        await userEvent.click(clipButton())
        expect(clipButton()).toHaveAttribute('aria-expanded', 'true')
        expect(clipButton()).toHaveAttribute('aria-disabled', 'true')
      },
    )
  })

  describe('something that arrives while the section is folded', () => {
    // The page owns both: the caption survives the privacy notice taking the pane's place and
    // handing it back, and a recording can be chosen without the section having been pressed.
    it('unfolds the caption when it is given text from outside', () => {
      const { rerender } = render(
        <ComposerOptions
          captions
          caption=""
          onCaptionChange={vi.fn()}
          clips={false}
          clip={aClipUpload()}
          limits={LIMITS}
        />,
      )
      expect(captionField()).not.toBeVisible()

      rerender(
        <ComposerOptions
          captions
          caption="Les confettis"
          onCaptionChange={vi.fn()}
          clips={false}
          clip={aClipUpload()}
          limits={LIMITS}
        />,
      )

      expect(captionField()).toBeVisible()
      expect(captionButton()).toHaveAttribute('aria-expanded', 'true')
    })

    it('unfolds the video section when a recording is chosen, and leaves it unfolded once cleared', () => {
      const props = {
        captions: false,
        caption: '',
        onCaptionChange: vi.fn(),
        clips: true,
        limits: LIMITS,
      }
      const { rerender } = render(<ComposerOptions {...props} clip={aClipUpload()} />)
      expect(screen.getByText(fr.upload.clipHint(15, 80))).not.toBeVisible()

      rerender(
        <ComposerOptions
          {...props}
          clip={aClipUpload({ stage: 'ready', file: new File([], 'p.mp4') })}
        />,
      )
      expect(screen.getByTestId('clip-state')).toBeVisible()

      // Cleared from a button inside the section: folding it now would drop focus on <body>.
      rerender(<ComposerOptions {...props} clip={aClipUpload()} />)
      expect(clipButton()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(fr.upload.clipHint(15, 80))).toBeVisible()
    })
  })

  describe('what the event allows', () => {
    it('shows nothing at all when the event allows neither a caption nor a video', () => {
      const { container } = render(<Harness captions={false} clips={false} />)

      // Only the sentinel that follows it.
      expect(container.querySelectorAll('button')).toHaveLength(1)
      expect(screen.queryByLabelText(new RegExp(fr.upload.captionLabel))).toBeNull()
      expect(screen.queryByTestId('clip-input')).toBeNull()
    })

    it('offers no caption affordance when captions are off, and keeps the video one', () => {
      render(<Harness captions={false} />)

      expect(screen.queryByRole('button', { name: fr.upload.captionLabel })).toBeNull()
      expect(screen.queryByLabelText(new RegExp(fr.upload.captionLabel))).toBeNull()
      expect(clipButton()).toBeVisible()
    })

    it('offers no video affordance when video is off, and keeps the caption one', () => {
      render(<Harness clips={false} />)

      expect(screen.queryByRole('button', { name: fr.upload.clipSection })).toBeNull()
      expect(screen.queryByTestId('clip-input')).toBeNull()
      expect(captionButton()).toBeVisible()
    })
  })
})
