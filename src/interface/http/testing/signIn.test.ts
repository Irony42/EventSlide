import { describe, expect, it } from 'vitest'
import { setCookies } from './signIn'

describe('setCookies', () => {
  it('reads a Set-Cookie that arrives as a single string, not only one that arrives as a list', () => {
    // The sweep's own copy read only the list, so a lone cookie was no cookie at all and
    // `csrfTokenFrom` would have reported that the server issued none.
    expect(setCookies({ 'set-cookie': 'es_csrf=abc; Path=/' })).toEqual(['es_csrf=abc; Path=/'])
  })

  it('reads every cookie of a list', () => {
    expect(
      setCookies({ 'set-cookie': ['es_csrf=abc; Path=/', 'es_session=s%3Aid; Path=/'] }),
    ).toEqual(['es_csrf=abc; Path=/', 'es_session=s%3Aid; Path=/'])
  })

  it('reads nothing from a response that set no cookie', () => {
    expect(setCookies({ 'content-type': 'application/json' })).toEqual([])
  })
})
