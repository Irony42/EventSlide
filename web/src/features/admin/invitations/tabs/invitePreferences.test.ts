import { afterEach, describe, expect, it, vi } from 'vitest'
import { readInvitePreferences, writeInvitePreferences } from './invitePreferences'

const KEY = 'eventslide.invite.fete'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('invite preferences', () => {
  it('reads nothing as nothing', () => {
    expect(readInvitePreferences('fete')).toEqual({})
  })

  it('keeps what was written, under the key of the event', () => {
    writeInvitePreferences('fete', {
      design: 'essentiel',
      colour: '#8e7cc3',
      format: 'a5',
      short: 'Venez',
    })

    expect(window.localStorage.getItem(KEY)).not.toBeNull()
    expect(readInvitePreferences('fete')).toEqual({
      design: 'essentiel',
      colour: '#8e7cc3',
      format: 'a5',
      short: 'Venez',
    })
    expect(readInvitePreferences('autre')).toEqual({})
  })

  it('never stores a link or a token: the value holds only the four choices', () => {
    writeInvitePreferences('fete', { design: 'essentiel', short: 'Venez' })

    expect(
      Object.keys(JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as object).sort(),
    ).toEqual(['design', 'short'])
  })

  it('keeps a value only when it is of the right kind, and drops the rest', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ design: 'nope', colour: 'red', format: 'a3', short: 5 }),
    )

    expect(readInvitePreferences('fete')).toEqual({})
  })

  it('lowercases a colour and refuses a word longer than the card holds', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ colour: '#8E7CC3', short: 'x'.repeat(141) }))

    expect(readInvitePreferences('fete')).toEqual({ colour: '#8e7cc3' })
  })

  it('keeps a word of exactly the limit', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ short: 'x'.repeat(140) }))

    expect(readInvitePreferences('fete').short).toHaveLength(140)
  })

  it('reads what is not JSON, or not an object, as nothing', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(readInvitePreferences('fete')).toEqual({})
    window.localStorage.setItem(KEY, '7')
    expect(readInvitePreferences('fete')).toEqual({})
    window.localStorage.setItem(KEY, 'null')
    expect(readInvitePreferences('fete')).toEqual({})
  })

  it('works without storage: blocked storage reads as nothing and a write is a no-op', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(readInvitePreferences('fete')).toEqual({})
    expect(() => writeInvitePreferences('fete', { short: 'x' })).not.toThrow()
  })

  it('offers only the designs that have an invitation layout', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ design: 'classique' }))
    expect(readInvitePreferences('fete')).toEqual({})

    for (const design of [
      'essentiel',
      'ticket',
      'souvenir',
      'billet',
      'embarquement',
      'guirlande',
    ]) {
      window.localStorage.setItem(KEY, JSON.stringify({ design }))
      expect(readInvitePreferences('fete').design, design).toBe(design)
    }
  })

  it('keeps a focus only in percent, and knows nothing of a photograph: that one is the kit’s', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ focusX: 20, focusY: 100, photo: 'data:image/jpeg;base64,AAAA' }),
    )
    expect(readInvitePreferences('fete')).toEqual({ focusX: 20, focusY: 100 })

    window.localStorage.setItem(KEY, JSON.stringify({ focusX: 101, focusY: -1 }))
    expect(readInvitePreferences('fete')).toEqual({})
    window.localStorage.setItem(KEY, JSON.stringify({ focusX: 'x' }))
    expect(readInvitePreferences('fete')).toEqual({})
  })

  it('keeps the shape of the image and whether it shows the address, and nothing else for them', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ shot: 'story', showAddress: true }))
    expect(readInvitePreferences('fete')).toEqual({ shot: 'story', showAddress: true })

    window.localStorage.setItem(KEY, JSON.stringify({ shot: 'banner', showAddress: 'yes' }))
    expect(readInvitePreferences('fete')).toEqual({})
  })

  it('shows no address on the image until the host says so', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ shot: 'square' }))

    expect(readInvitePreferences('fete').showAddress).toBeUndefined()
  })
})
