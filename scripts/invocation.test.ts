import { describe, expect, it } from 'vitest'
import { commandLine, invocationOf } from './invocation'

describe('invocationOf', () => {
  it('reads a compiled entry point as the image, where the commands are run with node', () => {
    expect(invocationOf('/app/dist/ops/scripts/backup.js')).toBe('node')
  })

  it('reads the TypeScript source as a checkout, where npm runs it through tsx', () => {
    expect(invocationOf('C:\\src\\EventSlide\\scripts\\backup.ts')).toBe('npm')
  })
})

describe('commandLine', () => {
  it('spells a command the way npm needs it, with the arguments after --', () => {
    expect(commandLine('npm', 'restore', '/mnt/usb/wedding')).toBe(
      'npm run restore -- /mnt/usb/wedding',
    )
    expect(commandLine('npm', 'verify', '<archive>')).toBe('npm run backup:verify -- <archive>')
    expect(commandLine('npm', 'backup')).toBe('npm run backup')
  })

  it('spells the same command as the compiled file the image carries', () => {
    expect(commandLine('node', 'restore', '/data/backups/x')).toBe(
      'node dist/ops/scripts/restore.js /data/backups/x',
    )
    expect(commandLine('node', 'verify', '<archive>')).toBe(
      'node dist/ops/scripts/backup.js --verify <archive>',
    )
    expect(commandLine('node', 'backup')).toBe('node dist/ops/scripts/backup.js')
  })
})
