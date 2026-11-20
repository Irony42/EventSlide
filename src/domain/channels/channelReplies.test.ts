import { describe, expect, it } from 'vitest'

import { EVENT_LANGUAGES } from '../events/eventLanguage'
import {
  PLAIN_REASONS,
  REPLY_COOLDOWN_MS,
  frenchTypography,
  isThrottled,
  mayReply,
  renderReply,
  replyKey,
  replyReasonOfCode,
  type BotReply,
} from './channelReplies'

const NOTICE = 'https://app.example/e/mariage/privacy'
const NBSP = String.fromCharCode(0xa0)

const everyReply = (): BotReply[] => [
  ...PLAIN_REASONS.map((reason): BotReply => ({ reason })),
  { reason: 'bound', eventName: 'Mariage Léa & Tom', moderated: true, noticeUrl: NOTICE },
  { reason: 'bound', eventName: 'Mariage Léa & Tom', moderated: false, noticeUrl: NOTICE },
  { reason: 'unbound', eventName: 'Mariage Léa & Tom' },
  { reason: 'privacy', noticeUrl: NOTICE },
]

describe('renderReply', () => {
  it.each(EVENT_LANGUAGES)(
    'says every reply in %s, in plain text without any Markdown',
    (language) => {
      for (const reply of everyReply()) {
        const text = renderReply(reply, language)
        expect(text.length).toBeGreaterThan(10)
        expect(text).not.toMatch(/[*`]/u)
      }
    },
  )

  it('gives the five languages five different wordings', () => {
    for (const reason of PLAIN_REASONS) {
      const texts = new Set(EVENT_LANGUAGES.map((language) => renderReply({ reason }, language)))
      expect(texts.size, reason).toBe(EVENT_LANGUAGES.length)
    }
  })

  it('answers in French when the conversation has no event yet', () => {
    expect(renderReply({ reason: 'forgotten' }, null)).toBe(
      renderReply({ reason: 'forgotten' }, 'fr'),
    )
    expect(renderReply({ reason: 'forgotten' }, 'fr')).toBe(
      "C'est fait, vos photos ont été retirées.",
    )
  })

  it('says whom the group sends to, what happens next, and where the notice is', () => {
    const moderated = renderReply(
      { reason: 'bound', eventName: 'Mariage Léa & Tom', moderated: true, noticeUrl: NOTICE },
      'fr',
    )
    expect(moderated).toContain(`«${NBSP}Mariage Léa & Tom${NBSP}»`)
    expect(moderated).toContain("passent par l'organisateur")
    expect(moderated).toContain('/oublier')
    expect(moderated.endsWith(NOTICE)).toBe(true)

    const direct = renderReply(
      { reason: 'bound', eventName: 'X', moderated: false, noticeUrl: NOTICE },
      'fr',
    )
    expect(direct).toContain('directement sur le mur')
    const english = renderReply(
      { reason: 'bound', eventName: 'X', moderated: true, noticeUrl: NOTICE },
      'en',
    )
    expect(english).toContain('go through the organiser')
  })

  it('names the event in the unbound message and the notice in the privacy one', () => {
    expect(renderReply({ reason: 'unbound', eventName: 'Fête' }, 'en')).toContain('"Fête"')
    expect(renderReply({ reason: 'privacy', noticeUrl: NOTICE }, 'de')).toContain(NOTICE)
  })

  it('keeps an event name exactly as the host wrote it, whatever it holds', () => {
    const name = '*_`[x](y) <b>'
    expect(renderReply({ reason: 'unbound', eventName: name }, 'en')).toContain(name)
  })
})

describe('what the host wrote in a French reply', () => {
  it('is never given the typography: only the phrase is', () => {
    const name = 'Fête : à ? ! « x »'
    const text = renderReply({ reason: 'unbound', eventName: name }, 'fr')
    expect(text).toContain('«' + NBSP + name + NBSP + '»')
    const bound = renderReply(
      { reason: 'bound', eventName: 'A', moderated: false, noticeUrl: 'https://x.test/a b ?' },
      'fr',
    )
    expect(bound.endsWith('https://x.test/a b ?')).toBe(true)
  })

  it('quotes at most 80 characters of the event name, so a reply stays far under 4096', () => {
    const long = 'é'.repeat(5000)
    const text = renderReply({ reason: 'unbound', eventName: long }, 'en')
    expect(text).toContain('"' + 'é'.repeat(80) + '…"')
    expect(text.length).toBeLessThan(200)
    const exact = 'a'.repeat(80)
    expect(renderReply({ reason: 'unbound', eventName: exact }, 'en')).toContain('"' + exact + '"')
  })
})

describe('frenchTypography', () => {
  it('puts a no-break space before : ; ! ? and inside the guillemets', () => {
    expect(frenchTypography('Ça : oui ; non ! vraiment ?')).toBe(
      `Ça${NBSP}: oui${NBSP}; non${NBSP}! vraiment${NBSP}?`,
    )
    expect(frenchTypography('« Léa »')).toBe(`«${NBSP}Léa${NBSP}»`)
  })

  it('applies to every French reply', () => {
    expect(renderReply({ reason: 'noCode' }, 'fr')).toContain(`soirée${NBSP}:`)
  })
})

describe('anti-chatter', () => {
  it('rations the refusals of a media, not the answers to a command', () => {
    expect(isThrottled('quotaReached')).toBe(true)
    expect(isThrottled('mediaTooLarge')).toBe(true)
    expect(isThrottled('tooFast')).toBe(true)
    expect(isThrottled('albumFull')).toBe(true)
    expect(isThrottled('channelOff')).toBe(true)
    expect(isThrottled('forgetFailed')).toBe(false)
    expect(isThrottled('bound')).toBe(false)
    expect(isThrottled('forgotten')).toBe(false)
    expect(isThrottled('unknownCode')).toBe(false)
  })

  it('answers once an hour per conversation, sender and reason', () => {
    const last = new Date('2026-11-19T20:00:00Z')
    expect(mayReply(null, last)).toBe(true)
    expect(mayReply(last, new Date(last.getTime() + REPLY_COOLDOWN_MS - 1))).toBe(false)
    expect(mayReply(last, new Date(last.getTime() + REPLY_COOLDOWN_MS))).toBe(true)
  })

  it('keys a reply by all three, without letting one collide with another', () => {
    const base = replyKey('-1', '2', 'tooFast')
    expect(replyKey('-1', '2', 'tooFast')).toBe(base)
    expect(replyKey('-1', '3', 'tooFast')).not.toBe(base)
    expect(replyKey('-2', '2', 'tooFast')).not.toBe(base)
    expect(replyKey('-1', '2', 'quotaReached')).not.toBe(base)
    expect(replyKey('-1 2', '', 'tooFast')).not.toBe(replyKey('-1', ' 2', 'tooFast'))
  })
})

describe('replyReasonOfCode', () => {
  it.each([
    ['channel.unknownCode', 'unknownCode'],
    ['channel.notAllowed', 'notAllowed'],
    ['channel.eventNotOpen', 'eventNotOpen'],
    ['channel.alreadyBound', 'conversationBusy'],
    ['channel.mediaTooLarge', 'mediaTooLarge'],
    ['channel.videoNotAccepted', 'videoNotAccepted'],
    ['channel.unsupportedFormat', 'unsupportedFormat'],
    ['event.photoLimitReached', 'quotaReached'],
    ['event.quotaExceeded', 'albumFull'],
    ['client.storageFull', 'albumFull'],
    ['event.notAcceptingUploads', 'eventClosed'],
    ['event.clipsNotAllowed', 'videoNotAccepted'],
    ['image.unsupportedFormat', 'unsupportedFormat'],
    ['image.animated', 'unsupportedFormat'],
    ['image.corrupt', 'unsupportedFormat'],
    ['clip.unsupportedFormat', 'unsupportedFormat'],
    ['clip.corrupt', 'unsupportedFormat'],
    ['clip.noVideoStream', 'unsupportedFormat'],
    ['clip.probeUnreadable', 'unsupportedFormat'],
    ['clip.tooLong', 'mediaTooLarge'],
    ['photo.pixelBudgetExceeded', 'mediaTooLarge'],
    ['clip.pixelBudgetExceeded', 'mediaTooLarge'],
    ['clip.queueFull', 'tooFast'],
  ])('words %s as %s', (code, reason) => {
    expect(replyReasonOfCode(code)).toBe(reason)
  })

  it('has nothing to say about a code it does not know', () => {
    expect(replyReasonOfCode('event.notFound')).toBeNull()
  })
})

describe('a bot that cannot see the photographs of its group', () => {
  const bound = (mediaBlind: boolean | undefined) =>
    ({
      reason: 'bound',
      eventName: 'Mariage',
      moderated: false,
      noticeUrl: NOTICE,
      ...(mediaBlind === undefined ? {} : { mediaBlind }),
    }) as const

  it.each(EVENT_LANGUAGES)('adds a paragraph about it to the bound reply in %s', (language) => {
    const plain = renderReply(bound(false), language)
    const warned = renderReply(bound(true), language)

    expect(warned.startsWith(plain)).toBe(true)
    expect(warned.slice(plain.length)).toMatch(/^\n\n\S/u)
    expect(warned.length).toBeGreaterThan(plain.length + 60)
  })

  it('says nothing more when it can see them, or when it does not know', () => {
    expect(renderReply(bound(undefined), 'fr')).toBe(renderReply(bound(false), 'fr'))
  })

  it('asks to be named administrator, in French with its typography', () => {
    const text = renderReply(bound(true), 'fr')

    expect(text).toContain(
      `Attention${NBSP}: je ne vois pas encore les photos de ce groupe. Nommez-moi administrateur du groupe (aucun droit particulier n’est nécessaire), puis postez vos photos.`,
    )
  })

  it.each(EVENT_LANGUAGES)('thanks the group once it is an administrator, in %s', (language) => {
    expect(renderReply({ reason: 'nowSeesMedia' }, language).length).toBeGreaterThan(10)
    expect(isThrottled('nowSeesMedia')).toBe(false)
  })

  it('thanks in French', () => {
    expect(renderReply({ reason: 'nowSeesMedia' }, 'fr')).toBe(
      'Merci, je vois maintenant les photos de ce groupe.',
    )
  })
})
