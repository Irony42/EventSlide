import { describe, expect, it } from 'vitest'

import { parseCommand } from './inboundMessage'

describe('parseCommand', () => {
  it.each([
    ['/soiree ABCD-1234', 'bind', 'ABCD-1234'],
    ['/soirée ABCD-1234', 'bind', 'ABCD-1234'],
    ['/SOIREE abcd 1234', 'bind', 'abcd 1234'],
    ['/soiree', 'bind', ''],
    ['/soiree   ', 'bind', ''],
    ['  /soiree\tABCD  ', 'bind', 'ABCD'],
    ['/oublier', 'forget', ''],
    ['/confidentialite', 'privacy', ''],
    ['/confidentialité', 'privacy', ''],
  ])('reads %j as %s with the argument %j', (text, command, argument) => {
    expect(parseCommand(text, 'EventSlideBot')).toEqual({ command, argument })
  })

  it('accepts a command addressed to this bot, in any case', () => {
    expect(parseCommand('/soiree@eventslidebot ABCD', 'EventSlideBot')).toEqual({
      command: 'bind',
      argument: 'ABCD',
    })
    expect(parseCommand('/oublier@EVENTSLIDEBOT', 'EventSlideBot')).toEqual({
      command: 'forget',
      argument: '',
    })
  })

  it('ignores a command addressed to another bot of the group', () => {
    expect(parseCommand('/soiree@OtherBot ABCD', 'EventSlideBot')).toBeNull()
  })

  it('keeps only the first line as the argument', () => {
    expect(parseCommand('/soiree ABCD\nsecond line', 'EventSlideBot')).toEqual({
      command: 'bind',
      argument: 'ABCD',
    })
  })

  it.each([
    '',
    'hello',
    'soiree ABCD',
    '/ soiree',
    '/',
    '/start',
    '/constructor',
    '/soireeX',
    'a /soiree',
  ])('ignores %j, which is not one of our commands', (text) => {
    expect(parseCommand(text, 'EventSlideBot')).toBeNull()
  })
})
