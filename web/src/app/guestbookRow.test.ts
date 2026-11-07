import { describe, expect, it } from 'vitest'
import { fr } from '../lib/i18n/fr'
import { GUESTBOOK_STATUS_TONE, guestbookDateFormat, guestbookStatusLabel } from './guestbookRow'

describe('guestbookRow', () => {
  it('words each status in the host copy', () => {
    expect(guestbookStatusLabel('pending', fr)).toBe(fr.guestbookHost.statusPending)
    expect(guestbookStatusLabel('published', fr)).toBe(fr.guestbookHost.statusPublished)
    expect(guestbookStatusLabel('rejected', fr)).toBe(fr.guestbookHost.statusRejected)
    expect(guestbookStatusLabel('hidden', fr)).toBe(fr.guestbookHost.statusHidden)
  })

  it('gives each status its tone', () => {
    expect(GUESTBOOK_STATUS_TONE).toEqual({
      pending: 'warning',
      published: 'success',
      rejected: 'danger',
      hidden: 'neutral',
    })
  })

  it('formats a date short, in the language it is given', () => {
    const iso = '2026-03-04T15:09:00.000Z'
    const expected = new Intl.DateTimeFormat('fr', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso))
    expect(guestbookDateFormat('fr')(iso)).toBe(expected)
    expect(guestbookDateFormat('en-US')(iso)).not.toBe(expected)
  })
})
