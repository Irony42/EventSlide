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

  it('ignores a command whose addressee is empty, instead of binding with the argument "@"', () => {
    expect(parseCommand('/soiree@', 'EventSlideBot')).toBeNull()
    expect(parseCommand('/soiree@ ABCD', 'EventSlideBot')).toBeNull()
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

describe('parseCommand: the aliases of the five languages', () => {
  it.each([
    ['soiree', 'bind'],
    ['event', 'bind'],
    ['feier', 'bind'],
    ['evento', 'bind'],
    ['oublier', 'forget'],
    ['forget', 'forget'],
    ['vergessen', 'forget'],
    ['olvidar', 'forget'],
    ['dimentica', 'forget'],
    ['confidentialite', 'privacy'],
    ['privacy', 'privacy'],
    ['datenschutz', 'privacy'],
    ['privacidad', 'privacy'],
  ])('reads /%s as %s, in any case, whatever the language of the group', (name, command) => {
    expect(parseCommand(`/${name} CODE`, 'EventSlideBot')).toEqual({ command, argument: 'CODE' })
    expect(parseCommand(`/${name.toUpperCase()}`, 'EventSlideBot')).toEqual({
      command,
      argument: '',
    })
  })

  it('folds the accents of an alias as it does for the French ones', () => {
    expect(parseCommand('/féier CODE', 'EventSlideBot')).toEqual({
      command: 'bind',
      argument: 'CODE',
    })
    expect(parseCommand('/Évènto', 'EventSlideBot')).toEqual({ command: 'bind', argument: '' })
  })

  it('answers to an alias addressed to this bot, and ignores one addressed to another', () => {
    expect(parseCommand('/event@EventSlideBot ABCD', 'EventSlideBot')).toEqual({
      command: 'bind',
      argument: 'ABCD',
    })
    expect(parseCommand('/event@OtherBot ABCD', 'EventSlideBot')).toBeNull()
    expect(parseCommand('/forget@OtherBot', 'EventSlideBot')).toBeNull()
  })

  it.each(['/events', '/foreign', '/privacyx', '/datenschutzx', '/constructor', '/start'])(
    'still reads %s as nothing of ours',
    (text) => {
      expect(parseCommand(text, 'EventSlideBot')).toBeNull()
    },
  )
})
