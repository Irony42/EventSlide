import { describe, expect, it } from 'vitest'
import { de } from '../../lib/i18n/de'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import { fr } from '../../lib/i18n/fr'
import { it as italian } from '../../lib/i18n/it'
import { aPrivacyNotice } from '../../testing/renderWithProviders'
import { noticeSections, selfRemovalSentence } from './noticeWording'

/**
 * The notice's wording, as a pure function of what the server said. `fr` is the table
 * the assertions compare against on purpose: this file states which sentence a value
 * selects, and the French one is the source the others are translated from.
 */

describe('selfRemovalSentence', () => {
  it.each([
    { seconds: 30, expected: fr.upload.noticeRemovalSeconds(30) },
    { seconds: 60, expected: fr.upload.noticeRemovalMinutes(1) },
    { seconds: 900, expected: fr.upload.noticeRemovalMinutes(15) },
    { seconds: 3_600, expected: fr.upload.noticeRemovalHours(1) },
    { seconds: 7_200, expected: fr.upload.noticeRemovalHours(2) },
  ])('says $seconds seconds in the unit a guest reads', ({ seconds, expected }) => {
    expect(selfRemovalSentence(seconds, fr)).toBe(expected)
  })

  it('rounds a window down, because a promise that overstates it stops working early', () => {
    // Ninety seconds is one minute, never two: the delete button would stop answering
    // thirty seconds before the notice said it would.
    expect(selfRemovalSentence(90, fr)).toBe(fr.upload.noticeRemovalMinutes(1))
    expect(selfRemovalSentence(5_400, fr)).toBe(fr.upload.noticeRemovalMinutes(90))
  })
})

describe('noticeSections', () => {
  it('answers the four questions in the order the roadmap asks them', () => {
    expect(noticeSections(aPrivacyNotice(), fr).map((section) => section.term)).toEqual([
      fr.upload.noticeWhatHappens,
      fr.upload.noticeWhoSees,
      fr.upload.noticeHowLong,
      fr.upload.noticeRemoval,
    ])
  })

  it('names every audience the server listed, and no other', () => {
    const [, whoSees] = noticeSections(aPrivacyNotice({ audiences: ['room'] }), fr)

    expect(whoSees?.sentences).toEqual([fr.upload.noticeAudiences.room])
  })

  it('always ends on asking the organiser, because a moderator can delete any photo', () => {
    const withWindow = noticeSections(aPrivacyNotice({ selfRemovalSeconds: 900 }), fr).at(-1)
    const without = noticeSections(aPrivacyNotice({ selfRemovalSeconds: null }), fr).at(-1)

    expect(withWindow?.sentences.at(-1)).toBe(fr.upload.noticeRemovalOtherwise)
    expect(without?.sentences).toEqual([fr.upload.noticeRemovalAskHost])
  })

  it.each([
    ['de', de],
    ['en', en],
    ['es', es],
    ['it', italian],
  ] as const)(
    'reads in %s as a translation, never as the French it came from',
    (_locale, table) => {
      // A section left in French in one table would put a French notice in front of a
      // guest who chose another language — at the one moment they are asked to read.
      const translated = noticeSections(aPrivacyNotice({ retentionDays: 30 }), table).flatMap(
        (section) => [section.term, ...section.sentences],
      )
      const french = noticeSections(aPrivacyNotice({ retentionDays: 30 }), fr).flatMap(
        (section) => [section.term, ...section.sentences],
      )

      expect(translated.filter((line, index) => line === french[index])).toEqual([])
    },
  )
})
