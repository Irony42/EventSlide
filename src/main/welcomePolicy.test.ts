import { describe, expect, it } from 'vitest'
import { welcomeLinks } from './welcomePolicy'

const config = (contactEmail: string | null, supportUrl: string | null) => ({
  publicUrl: 'https://app.example.org',
  operator: { contactEmail, supportUrl },
})

describe('welcomeLinks', () => {
  it('names the contact and the support page as they are when it is an absolute URL', () => {
    const links = welcomeLinks(config('contact@example.org', 'https://example.org/guides'))
    expect(links?.contact.value).toBe('contact@example.org')
    expect(links?.guidesLink).toBe('https://example.org/guides')
  })

  it('makes a path on this site absolute', () => {
    expect(welcomeLinks(config('contact@example.org', '/help'))?.guidesLink).toBe(
      'https://app.example.org/help',
    )
  })

  it('is null when the contact or the page is not set, or the contact is not an address', () => {
    expect(welcomeLinks(config(null, '/help'))).toBeNull()
    expect(welcomeLinks(config('contact@example.org', null))).toBeNull()
    expect(welcomeLinks(config('not an address', '/help'))).toBeNull()
  })
})
