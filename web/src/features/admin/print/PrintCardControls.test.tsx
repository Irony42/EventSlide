import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { PrintCardControls, type PrintCardControlsProps } from './PrintCardControls'
import type * as PrintPhoto from './printPhoto'

const prepare = vi.hoisted(() => vi.fn<(file: Blob) => Promise<string | null>>())
vi.mock('./printPhoto', async (original) => ({
  ...(await original<typeof PrintPhoto>()),
  preparePrintPhoto: prepare,
}))

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

const props = (overrides: Partial<PrintCardControlsProps> = {}): PrintCardControlsProps => ({
  design: 'essentiel',
  onDesign: vi.fn(),
  texts: {},
  onText: vi.fn(),
  eventName: 'Camille & Sacha',
  steps: true,
  onSteps: vi.fn(),
  photoUrl: null,
  onPhoto: vi.fn(),
  focusX: 50,
  focusY: 50,
  onFocus: vi.fn(),
  colour: null,
  onColour: vi.fn(),
  eventColour: 'oklch(58% 0.14 20)',
  accentHue: 20,
  locale: 'fr',
  previewTexts: { title: 'Camille & Sacha', tagline: null, note: null, date: null, table: null },
  ...overrides,
})

const renderControls = (overrides: Partial<PrintCardControlsProps> = {}) => {
  const all = props(overrides)
  renderWithProviders(<PrintCardControls {...all} />, { api: fakeApi({}) })
  return all
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('PrintCardControls', () => {
  it('hands every word up as the host types it, the note included', async () => {
    const user = userEvent.setup()
    const { onText } = renderControls()

    await user.type(screen.getByLabelText(fr.admin.printKitNote), 'A')
    await user.type(screen.getByLabelText(fr.admin.printKitDate), 'B')

    expect(onText).toHaveBeenCalledWith('note', 'A')
    expect(onText).toHaveBeenCalledWith('date', 'B')
  })

  it('shows the usual line and an example date where nothing is typed yet', () => {
    renderControls()
    expect(screen.getByLabelText(fr.admin.printKitTagline)).toHaveAttribute(
      'placeholder',
      fr.printKit.title,
    )
    expect(screen.getByLabelText(fr.admin.printKitDate)).toHaveAttribute(
      'placeholder',
      fr.admin.printKitDateExample,
    )
  })

  it('prepares a chosen photograph in the browser and hands up the result', async () => {
    prepare.mockResolvedValue(JPEG)
    const { onPhoto } = renderControls()

    fireEvent.change(screen.getByTestId('print-photo-input'), {
      target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] },
    })

    await vi.waitFor(() => expect(onPhoto).toHaveBeenCalledWith(JPEG))
    expect(screen.queryByText(fr.admin.printKitPhotoFailed)).toBeNull()
  })

  it('says so when the image cannot be read, and keeps the photograph it had', async () => {
    prepare.mockResolvedValue(null)
    const { onPhoto } = renderControls()

    fireEvent.change(screen.getByTestId('print-photo-input'), {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    })

    expect(await screen.findByText(fr.admin.printKitPhotoFailed)).toBeInTheDocument()
    expect(onPhoto).not.toHaveBeenCalled()
  })

  it('keeps the hidden file input out of the tab order: the button opens it', () => {
    renderControls()
    const input = screen.getByTestId('print-photo-input')
    expect(input).toHaveAttribute('tabindex', '-1')
    expect(input).toHaveAttribute('aria-hidden', 'true')
  })

  it('offers no framing until there is a photograph', () => {
    renderControls()
    expect(screen.queryByLabelText(fr.admin.printKitFocusX)).toBeNull()
  })

  it('moves the framing of the photograph on both axes', () => {
    const { onFocus } = renderControls({ photoUrl: JPEG })

    fireEvent.change(screen.getByLabelText(fr.admin.printKitFocusX), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(fr.admin.printKitFocusY), { target: { value: '80' } })

    expect(onFocus).toHaveBeenCalledWith('focusX', 20)
    expect(onFocus).toHaveBeenCalledWith('focusY', 80)
  })

  it('takes a free colour from the picker in lower case, and nothing else', () => {
    const { onColour } = renderControls()
    const picker = screen.getByLabelText(fr.admin.printKitColourCustom)

    fireEvent.change(picker, { target: { value: '#A1B2C3' } })

    expect(onColour).toHaveBeenCalledWith('#a1b2c3')
  })

  it('names the steps switch and hands it up', async () => {
    const user = userEvent.setup()
    const { onSteps } = renderControls()
    await user.click(screen.getByRole('checkbox', { name: fr.admin.printKitSteps }))
    expect(onSteps).toHaveBeenCalledWith(false)
  })
})
