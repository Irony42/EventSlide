import { describe, expect, it } from 'vitest'
import { welcomeLinks, welcomeMissing } from './welcomePolicy'

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

  it('joins a path to a public URL with a trailing slash by a single slash', () => {
    const links = welcomeLinks({
      publicUrl: 'https://app.example.org/',
      operator: { contactEmail: 'contact@example.org', supportUrl: '/help' },
    })
    expect(links?.guidesLink).toBe('https://app.example.org/help')
  })

  it('is null when the contact or the page is not set, or the contact is not an address', () => {
    expect(welcomeLinks(config(null, '/help'))).toBeNull()
    expect(welcomeLinks(config('contact@example.org', null))).toBeNull()
    expect(welcomeLinks(config('not an address', '/help'))).toBeNull()
  })
})

describe('welcomeMissing', () => {
  it('names each missing variable, and none when both are set', () => {
    expect(welcomeMissing({ operator: { contactEmail: null, supportUrl: null } })).toEqual([
      'OPERATOR_CONTACT_EMAIL (needs OPERATOR_NAME)',
      'SUPPORT_URL',
    ])
    expect(welcomeMissing({ operator: { contactEmail: 'a@b.test', supportUrl: null } })).toEqual([
      'SUPPORT_URL',
    ])
    expect(welcomeMissing({ operator: { contactEmail: null, supportUrl: '/h' } })).toEqual([
      'OPERATOR_CONTACT_EMAIL (needs OPERATOR_NAME)',
    ])
    expect(welcomeMissing({ operator: { contactEmail: 'a@b.test', supportUrl: '/h' } })).toEqual([])
  })
})
