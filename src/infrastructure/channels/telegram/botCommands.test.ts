import { describe, expect, it } from 'vitest'
import { parseCommand } from '../../../domain/channels/inboundMessage'
import { BOT_COMMAND_MENUS } from './botCommands'

describe('the command menus', () => {
  it('cover the default scope and the four languages', () => {
    expect(BOT_COMMAND_MENUS.map((menu) => menu.languageCode)).toEqual([
      null,
      'fr',
      'de',
      'es',
      'it',
    ])
  })

  it.each(BOT_COMMAND_MENUS)(
    'list in $languageCode names the bot accepts, bind then forget then privacy',
    (menu) => {
      const commands = menu.commands.map(
        (entry) => parseCommand(`/${entry.command}`, 'Bot')?.command,
      )

      expect(commands).toEqual(['bind', 'forget', 'privacy'])
    },
  )

  it('give each command a short description of its own, within what Telegram takes', () => {
    for (const menu of BOT_COMMAND_MENUS) {
      for (const entry of menu.commands) {
        expect(entry.description.length).toBeGreaterThan(5)
        expect(entry.description.length).toBeLessThanOrEqual(256)
        expect(entry.command).toMatch(/^[a-z]{1,32}$/u)
      }
    }
    const english = BOT_COMMAND_MENUS[0]?.commands.map((entry) => entry.description)
    const french = BOT_COMMAND_MENUS[1]?.commands.map((entry) => entry.description)
    expect(french).not.toEqual(english)
  })
})
