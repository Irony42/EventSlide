import { describe, expect, it } from 'vitest'
import { FILM_LOOK_CLASS, filmLook } from './filmLook'
import base from './base.css?raw'
import wallMedia from '../features/wall/components/WallMedia.module.css?raw'
import myPhotos from '../features/guest-upload/components/MyPhotos.module.css?raw'

/**
 * The film look is one recipe (spec 23), and two things about it are claims a stylesheet cannot make
 * itself and a screenshot would only notice once they were broken.
 *
 * - **A photograph that develops interpolates into the look** instead of snapping: a CSS filter list
 *   interpolates function by function, so the look's list must start with the functions of the veil,
 *   in the same order (`.undeveloped` in `MyPhotos.module.css`).
 * - **The projector wears one function, not five**: the measured budget of the spotlight
 *   (`tests/e2e/perf/film-look.spec.ts`). A function added to the wall's recipe is a cost nobody
 *   measured, on the machine least able to pay it.
 */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The text between the braces of the first rule that has exactly this selector. */
const ruleBody = (css: string, selector: string): string => {
  const source = withoutComments(css)
  const at = source.indexOf(selector + ' {')
  if (at < 0) throw new Error('no rule for ' + selector)
  return source.slice(source.indexOf('{', at) + 1, source.indexOf('}', at))
}

const filterOf = (css: string, selector: string): string => {
  const declaration = /filter:\s*([^;]+);/.exec(ruleBody(css, selector))
  if (declaration?.[1] === undefined) throw new Error('no filter declared by ' + selector)
  return declaration[1].replace(/\s+/g, ' ').trim()
}

const functionsOf = (list: string): readonly string[] =>
  [...list.matchAll(/([a-z-]+)\(/g)].flatMap((match) => (match[1] === 'var' ? [] : [match[1]!]))

describe('the film look recipe', () => {
  it('is a class set only when the server says so', () => {
    expect(filmLook(true)).toBe(FILM_LOOK_CLASS)
    expect(filmLook(false)).toBe(false)
    expect(filmLook(undefined)).toBe(false)
  })

  it('is defined once, in the shared sheet, under the name the surfaces ask for', () => {
    expect(FILM_LOOK_CLASS).toBe('filmLook')
    expect(filterOf(base, '.filmLook')).not.toBe('')
  })

  it('starts with the functions of the veil, in order, so a developing photograph interpolates', () => {
    const veil = functionsOf(filterOf(myPhotos, '.undeveloped'))
    const look = functionsOf(filterOf(base, '.filmLook'))

    expect(veil.length).toBeGreaterThan(0)
    expect(look.slice(0, veil.length)).toEqual(veil)
  })

  it('has the projector wear exactly one function', () => {
    expect(functionsOf(filterOf(wallMedia, '.film:global(.filmLook)'))).toHaveLength(1)
  })

  it('declares no transition of its own: the existing one develops it, and reduced motion has none', () => {
    const rule = ruleBody(base, '.filmLook')
    expect(rule).not.toMatch(/transition|animation/)
  })
})
