import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What the recording screen owes the thumb and the vestibular system (spec 25, section 12), read from
 * the stylesheet: jsdom lays nothing out, so a size and a media query can only be held as text, the
 * way `tokens.contrast.test.ts` holds the colours. The behaviour (the announcements, the keyboard) is
 * in `GuestUploadPage.voice.test.tsx`.
 */

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')
const css = read('web/src/features/guest-upload/components/VoiceComposer.module.css')
const tokens = read('web/src/design-system/tokens.css')

const ruleOf = (selector: string, source = css): string => {
  const start = source.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no ${selector} rule`)
  return source.slice(start, source.indexOf('}', start))
}

describe('the record button', () => {
  it('is 56 px at least, through the one token for it', () => {
    expect(tokens).toMatch(/--touch-record:\s*3\.5rem;/)
    expect(ruleOf('.record')).toContain('min-height: var(--touch-record)')
    expect(ruleOf('.record')).toContain('min-width: var(--touch-record)')
  })

  it('is round, and shows a focus ring that is not the colour alone', () => {
    expect(ruleOf('.record')).toContain('border-radius: var(--radius-full)')
    expect(ruleOf('.record:focus-visible')).toContain('outline: 3px solid')
  })
})

describe('the level meter', () => {
  it('does not move under prefers-reduced-motion: it is a static bar, with no transition', () => {
    const media = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(media).toContain('.bar {')
    expect(media).toContain('transform: none')
    expect(media).toContain('transition: none')
  })

  it('is hidden from assistive technology in the markup, so only the text says where the recording is', () => {
    const source = read('web/src/features/guest-upload/components/VoiceComposer.tsx')
    expect(source).toContain('aria-hidden="true"')
    expect(source).toContain('role="status"')
  })
})
