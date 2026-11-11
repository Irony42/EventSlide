import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PHONE_QUERY,
  moderationViewFor,
  onPhone,
  rememberModerationView,
  rememberedModerationView,
} from './moderationView'

/**
 * Which moderation screen a device opens: one address, two screens, the device's shape unless
 * the person chose otherwise on this device.
 */

describe('the screen a device opens', () => {
  it('is the phone’s on a phone and the laptop’s elsewhere, when nothing was chosen', () => {
    expect(moderationViewFor(null, true)).toBe('phone')
    expect(moderationViewFor(null, false)).toBe('desktop')
  })

  it('is the one the person chose, whatever the detection says, so a wrong guess can be undone', () => {
    expect(moderationViewFor('desktop', true)).toBe('desktop')
    expect(moderationViewFor('phone', false)).toBe('phone')
  })
})

describe('the choice this device remembers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is nothing until one is made', () => {
    expect(rememberedModerationView()).toBeNull()
  })

  it('is the last one made', () => {
    rememberModerationView('phone')
    rememberModerationView('desktop')

    expect(rememberedModerationView()).toBe('desktop')
  })

  it('is nothing when the stored value is not one this build wrote', () => {
    localStorage.setItem('eventslide.moderation.view', 'tablet')

    expect(rememberedModerationView()).toBeNull()
  })

  it('is nothing, rather than a failure, where storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(rememberedModerationView()).toBeNull()
  })

  it('is lost quietly where storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private browsing')
    })

    expect(() => rememberModerationView('phone')).not.toThrow()
  })
})

describe('whether the screen is a phone’s', () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })

  it('asks for a narrow viewport or a coarse pointer, either of which makes it a phone', () => {
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    window.matchMedia = matchMedia

    expect(onPhone()).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith(PHONE_QUERY)
    expect(PHONE_QUERY).toBe('(max-width: 767px), (pointer: coarse)')
  })

  it('is a laptop when neither matches', () => {
    window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList)

    expect(onPhone()).toBe(false)
  })

  it('is a laptop in a browser that cannot say', () => {
    window.matchMedia = vi.fn(() => {
      throw new Error('no matchMedia')
    })

    expect(onPhone()).toBe(false)
  })
})
