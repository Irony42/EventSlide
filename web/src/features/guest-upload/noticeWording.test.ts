import { describe, expect, it } from 'vitest'
import { de } from '../../lib/i18n/de'
import { en } from '../../lib/i18n/en'
import { es } from '../../lib/i18n/es'
import { fr } from '../../lib/i18n/fr'
import { it as italian } from '../../lib/i18n/it'
import { aPrivacyNotice } from '../../testing/renderWithProviders'
import { noticeSections, selfRemovalSentence, voiceRemovalSentence } from './noticeWording'

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
    const [, whoSees] = noticeSections(aPrivacyNotice({ audiences: ['wall'] }), fr)

    expect(whoSees?.sentences).toEqual([fr.upload.noticeAudiences.wall])
  })

  it('always asks the organiser and ends on the guest own delete-everything button, on every event', () => {
    const withWindow = noticeSections(aPrivacyNotice({ selfRemovalSeconds: 900 }), fr).at(-1)
    const without = noticeSections(aPrivacyNotice({ selfRemovalSeconds: null }), fr).at(-1)

    const erasure = fr.upload.noticeErasure(fr.upload.eraseOpen, fr.upload.mine)

    expect(withWindow?.sentences.at(-2)).toBe(fr.upload.noticeRemovalOtherwise)
    expect(withWindow?.sentences.at(-1)).toBe(erasure)
    expect(without?.sentences).toEqual([fr.upload.noticeRemovalAskHost, erasure])
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

/**
 * The line that names who hosts the photograph (roadmap G2-17 / P3-18). The server decided
 * whether there is one — the notice carries an `operator` only on a box whose operator named
 * themselves — and this module only words it.
 */
describe('noticeSections, the operator', () => {
  const OPERATOR = 'Association Les Photographes'

  it('adds nothing on a notice that names no operator, which is every self-hosted box', () => {
    expect(noticeSections(aPrivacyNotice(), fr)).toHaveLength(4)
  })

  it('ends on "Hébergé par" with the operator’s name when the notice names one', () => {
    const sections = noticeSections(aPrivacyNotice({ operator: OPERATOR }), fr)

    expect(sections).toHaveLength(5)
    expect(sections.at(-1)).toEqual({ term: fr.about.operatorHostedBy, sentences: [OPERATOR] })
  })

  it('keeps the four answers where they were, so naming an operator moves nothing', () => {
    const bare = noticeSections(aPrivacyNotice(), fr)
    const named = noticeSections(aPrivacyNotice({ operator: OPERATOR }), fr)

    expect(named.slice(0, 4)).toEqual(bare)
  })

  it.each([
    ['de', de],
    ['en', en],
    ['es', es],
    ['it', italian],
  ] as const)(
    'words the label in %s and leaves the name as the operator wrote it',
    (_locale, table) => {
      // The name is content, not interface: no table translates it. The label is interface.
      const last = noticeSections(aPrivacyNotice({ operator: OPERATOR }), table).at(-1)

      expect(last?.sentences).toEqual([OPERATOR])
      expect(last?.term).toBe(table.about.operatorHostedBy)
      expect(last?.term).not.toBe(fr.about.operatorHostedBy)
    },
  )
})

describe('noticeSections with a guestbook (spec 01)', () => {
  it('leaves the notice of an event without a guestbook exactly as it was', () => {
    const sections = noticeSections(aPrivacyNotice(), fr)
    expect(sections.map((section) => section.term)).toEqual([
      fr.upload.noticeWhatHappens,
      fr.upload.noticeWhoSees,
      fr.upload.noticeHowLong,
      fr.upload.noticeRemoval,
    ])
    expect(JSON.stringify(sections)).not.toContain(fr.guestbook.noticeMessageAudience)
  })

  it('titles the four questions for photos and messages, and adds one sentence to each', () => {
    const plain = noticeSections(aPrivacyNotice(), fr)
    const withBook = noticeSections(aPrivacyNotice({ guestbook: true }), fr)

    expect(withBook.map((section) => section.term)).toEqual([
      fr.guestbook.noticeWhatHappens,
      fr.guestbook.noticeWhoSees,
      fr.guestbook.noticeHowLong,
      fr.guestbook.noticeRemoval,
    ])
    withBook.forEach((section, index) => {
      expect(section.sentences.length).toBe((plain[index]?.sentences.length ?? 0) + 1)
    })
    expect(withBook[0]?.sentences).toContain(fr.guestbook.noticeMessagePublication.afterReview)
    expect(withBook[1]?.sentences).toContain(fr.guestbook.noticeMessageAudience)
    expect(withBook[2]?.sentences).toContain(fr.guestbook.noticeMessageRetention)
    expect(withBook[3]?.sentences).toContain(fr.guestbook.noticeMessageRemoval)
  })

  it('says a message goes straight to the screen on an event that publishes on arrival', () => {
    const sections = noticeSections(
      aPrivacyNotice({ guestbook: true, publication: 'immediate' }),
      fr,
    )
    expect(sections[0]?.sentences).toContain(fr.guestbook.noticeMessagePublication.immediate)
  })
})

describe('noticeSections with saving on (spec 24)', () => {
  const whoSees = (notice: ReturnType<typeof aPrivacyNotice>) =>
    noticeSections(notice, fr)[1]?.sentences ?? []

  it('says other guests can keep the photo, after the audiences, only when the server says so', () => {
    const audiences = aPrivacyNotice().audiences.map(
      (audience) => fr.upload.noticeAudiences[audience],
    )

    expect(whoSees(aPrivacyNotice({ guestSave: true }))).toEqual([
      ...audiences,
      fr.upload.noticeGuestSave,
    ])
  })

  it('leaves an event without it exactly as it was', () => {
    expect(JSON.stringify(noticeSections(aPrivacyNotice(), fr))).not.toContain(
      fr.upload.noticeGuestSave,
    )
  })

  it('says it with the guestbook’s sentences as well, in the same section', () => {
    const sentences = whoSees(aPrivacyNotice({ guestSave: true, guestbook: true }))

    expect(sentences).toContain(fr.upload.noticeGuestSave)
    expect(sentences).toContain(fr.guestbook.noticeMessageAudience)
  })

  it.each([
    ['en', en],
    ['de', de],
    ['es', es],
    ['it', italian],
  ])('has the sentence in %s, and not the French one', (_name, table) => {
    const sentence = noticeSections(aPrivacyNotice({ guestSave: true }), table)[1]?.sentences.at(-1)

    expect(sentence).toBe(table.upload.noticeGuestSave)
    expect(sentence).not.toBe(fr.upload.noticeGuestSave)
  })
})

describe('noticeSections with voice messages (spec 25)', () => {
  const book = { guestbook: true as const }
  const voice = { ...book, voice: true as const }
  const copy = fr.guestbookVoice
  const sentencesOf = (notice: ReturnType<typeof aPrivacyNotice>) =>
    noticeSections(notice, fr).flatMap((section) => section.sentences)

  it('leaves the notice of an event without voice messages exactly as it was', () => {
    // An event that does not take them says nothing about them, and nobody is asked to read it again.
    // The flags that qualify a voice (secret, a window) add nothing without `voice` itself.
    const plain = noticeSections(aPrivacyNotice({ ...book }), fr)

    expect(
      noticeSections(aPrivacyNotice({ ...book, voiceSealed: true, voiceRemovalSeconds: 900 }), fr),
    ).toEqual(plain)
    const flagless = plain.flatMap((section) => section.sentences)
    for (const sentence of [
      copy.noticeVoiceAudience,
      copy.noticeVoiceNeverRoom,
      copy.noticeVoiceMicrophone,
      copy.noticeVoiceSealed,
      copy.noticeVoiceRemovalAskHost,
    ]) {
      expect(flagless).not.toContain(sentence)
    }
  })

  it('says who hears it, that the room never does, and that the microphone only runs while recording', () => {
    const [whatHappens, whoSees] = noticeSections(aPrivacyNotice({ ...voice }), fr)

    expect(whoSees?.sentences).toContain(copy.noticeVoiceAudience)
    expect(whoSees?.sentences).toContain(copy.noticeVoiceNeverRoom)
    expect(whatHappens?.sentences).toContain(copy.noticeVoiceMicrophone)
  })

  it('says the organiser decides on a moderated event, and that nobody listens first on an automatic one', () => {
    const manual = sentencesOf(aPrivacyNotice({ ...voice, publication: 'afterReview' }))
    const auto = sentencesOf(aPrivacyNotice({ ...voice, publication: 'immediate' }))

    expect(manual).toContain(copy.noticeVoicePublication.afterReview)
    expect(manual).not.toContain(copy.noticeVoicePublication.immediate)
    expect(auto).toContain(copy.noticeVoicePublication.immediate)
    expect(auto).not.toContain(copy.noticeVoicePublication.afterReview)
  })

  it('says the voices stay secret only when the host keeps them so', () => {
    expect(sentencesOf(aPrivacyNotice({ ...voice, voiceSealed: true }))).toContain(
      copy.noticeVoiceSealed,
    )
    expect(sentencesOf(aPrivacyNotice({ ...voice }))).not.toContain(copy.noticeVoiceSealed)
  })

  it('says how long it is kept, with the days of the event when there are any', () => {
    expect(sentencesOf(aPrivacyNotice({ ...voice, retentionDays: 30 }))).toContain(
      copy.noticeVoiceRetentionDays(30),
    )
    expect(sentencesOf(aPrivacyNotice({ ...voice, retentionDays: null }))).toContain(
      copy.noticeVoiceRetention,
    )
  })

  it('says a guest may take it back for the window the server sent, and otherwise to ask the organiser', () => {
    const withWindow = sentencesOf(aPrivacyNotice({ ...voice, voiceRemovalSeconds: 900 }))
    const without = sentencesOf(aPrivacyNotice({ ...voice }))

    expect(withWindow).toContain(copy.noticeVoiceRemovalMinutes(15))
    expect(withWindow).not.toContain(copy.noticeVoiceRemovalAskHost)
    expect(without).toContain(copy.noticeVoiceRemovalAskHost)
  })

  it('keeps its removal sentence in the removal section, before the guest’s own delete-everything line', () => {
    const removal = noticeSections(aPrivacyNotice({ ...voice, voiceRemovalSeconds: 900 }), fr).at(
      -1,
    )

    expect(removal?.sentences.at(-1)).toBe(
      fr.upload.noticeErasure(fr.upload.eraseOpen, fr.upload.mine),
    )
    expect(removal?.sentences.at(-2)).toBe(copy.noticeVoiceRemovalMinutes(15))
  })

  it.each([
    ['fr', fr],
    ['en', en],
    ['de', de],
    ['es', es],
    ['it', italian],
  ])('words every clause of a voice notice in %s', (_locale, table) => {
    const sentences = noticeSections(
      aPrivacyNotice({ ...voice, voiceSealed: true, voiceRemovalSeconds: 900, retentionDays: 30 }),
      table,
    ).flatMap((section) => section.sentences)

    expect(sentences).toContain(table.guestbookVoice.noticeVoiceAudience)
    expect(sentences).toContain(table.guestbookVoice.noticeVoiceSealed)
    expect(sentences).toContain(table.guestbookVoice.noticeVoiceRetentionDays(30))
  })
})

describe('voiceRemovalSentence', () => {
  it.each([
    { seconds: 30, expected: fr.guestbookVoice.noticeVoiceRemovalSeconds(30) },
    { seconds: 60, expected: fr.guestbookVoice.noticeVoiceRemovalMinutes(1) },
    { seconds: 900, expected: fr.guestbookVoice.noticeVoiceRemovalMinutes(15) },
    { seconds: 3_600, expected: fr.guestbookVoice.noticeVoiceRemovalHours(1) },
  ])('says $seconds seconds in the unit a guest reads', ({ seconds, expected }) => {
    expect(voiceRemovalSentence(seconds, fr)).toBe(expected)
  })

  it('rounds a window down, as a promise that overstates it stops working early', () => {
    expect(voiceRemovalSentence(90, fr)).toBe(fr.guestbookVoice.noticeVoiceRemovalMinutes(1))
  })
})
