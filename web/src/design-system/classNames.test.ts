import { describe, expect, it } from 'vitest'
import { cx } from './classNames'

describe('cx', () => {
  it('joins the parts in the order given, with exactly one space between them', () => {
    expect(cx('card', 'raised', 'wide')).toBe('card raised wide')
  })

  it('drops what `condition && styles[...]` evaluates to when the condition is false', () => {
    const loading = false
    const block = true

    expect(cx('button', loading && 'loading', block && 'block')).toBe('button block')
  })

  it('drops undefined, which is what a class missing from the stylesheet reads as', () => {
    const styles: Readonly<Record<string, string | undefined>> = { badge: 'badge_1x' }

    // The template-literal spelling this replaces printed the word "undefined" here.
    expect(cx(styles['badge'], styles['neutral'])).toBe('badge_1x')
    expect(cx(styles['neutral'], styles['badge'])).toBe('badge_1x')
  })

  it('drops null and the empty string', () => {
    expect(cx('a', null, 'b', '', 'c')).toBe('a b c')
  })

  it('answers the empty string, never undefined, when nothing is left', () => {
    expect(cx()).toBe('')
    expect(cx(false, null, undefined, '')).toBe('')
  })

  it('passes a lone class through untouched', () => {
    expect(cx('only')).toBe('only')
  })

  it('keeps a caller-supplied className whole, after the primitive own classes', () => {
    expect(cx('field', undefined, 'caller one two')).toBe('field caller one two')
  })
})
