import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '../i18n/locale'
import { TRANSLATIONS } from '../i18n/translations'
import { noticeText } from './pushNotice'

/**
 * The worker has no locale table of its own (a service worker does not load the app's), so
 * `pushNotice.ts` holds the words of the notification; this holds them to the translation tables, where
 * they are written by hand and reviewed: a reworded or mistranslated one cannot drift in the worker alone.
 */

describe('the notification’s words', () => {
  it.each(SUPPORTED_LOCALES)('%s: the worker says what the translation table says', (locale) => {
    const table = TRANSLATIONS[locale].rsvp.push

    expect(noticeText(1, locale).body).toBe(table.noticeOne)
    expect(noticeText(null, locale).body).toBe(table.noticeSome)
    for (const count of [2, 3, 12, 100]) {
      expect(noticeText(count, locale).body).toBe(table.noticeMany(count))
    }
  })
})
