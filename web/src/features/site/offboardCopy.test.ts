import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES } from '../../lib/i18n/locale'
import { TRANSLATIONS } from '../../lib/i18n/translations'

/**
 * What the console says about the window of an offboarding names no number.
 *
 * The range of the window is the server's (`client.graceInvalid`, answered with the bare code):
 * the console checks nothing but "is this whole days", and a sentence that printed a bound would be
 * a copy of the server's rule that stays true only until somebody changes it there. The four
 * sentences that talk about the window (the field's label and hint, the introduction, and the
 * refusal) are held digit-free in all five languages, so a bound cannot creep back in as copy.
 *
 * Not the confirmation, which names the number of days the operator typed: that one is *their*
 * number, and it is a parameter.
 */
describe('what the console says about the window of an offboarding', () => {
  it.each(SUPPORTED_LOCALES)('%s: names no number', (locale) => {
    const text = TRANSLATIONS[locale]
    const sentences = {
      graceDays: text.site.graceDays,
      graceDaysHint: text.site.graceDaysHint,
      offboardIntro: text.site.offboardIntro,
      daysNotWhole: text.site.daysNotWhole,
      'client.graceInvalid': text.errors['client.graceInvalid'],
    }

    for (const [name, sentence] of Object.entries(sentences)) {
      expect(sentence, `${locale}.${name}`).not.toMatch(/\d/u)
    }
  })

  it.each(SUPPORTED_LOCALES)(
    '%s: says "at the latest" wherever it names the purge date',
    (locale) => {
      // The date is an upper bound: an event's own retention or a ceiling of the client purges sooner
      // (docs/API.md, offboard). A sentence that says "when the delay runs out" would promise the
      // client a time to export that the server does not guarantee.
      const AT_THE_LATEST: Readonly<Record<(typeof SUPPORTED_LOCALES)[number], RegExp>> = {
        fr: /au plus tard/iu,
        en: /at the latest/iu,
        de: /spätestens/iu,
        es: /como muy tarde/iu,
        it: /al più tardi/iu,
      }
      const text = TRANSLATIONS[locale]
      const sentences = {
        offboardIntro: text.site.offboardIntro,
        offboardConfirmBody: text.site.offboardConfirmBody(7),
        offboardConfirmBodyOne: text.site.offboardConfirmBody(1),
        offboardingRunning: text.site.offboardingRunning,
        purgeOn: text.site.purgeOn('2026-07-21'),
      }

      for (const [name, sentence] of Object.entries(sentences)) {
        expect(sentence, `${locale}.${name}`).toMatch(AT_THE_LATEST[locale])
      }
    },
  )
})
