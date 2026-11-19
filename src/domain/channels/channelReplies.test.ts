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
