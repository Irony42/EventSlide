import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { PrivacyNoticeCard, PrivacyNoticeDialog } from './PrivacyNotice'
import { fr } from '../../../lib/i18n/fr'
import { SUPPORTED_LOCALES } from '../../../lib/i18n/locale'
import { TRANSLATIONS } from '../../../lib/i18n/translations'
import {
  aPrivacyNotice,
  aPrivacyNoticeState,
  anAbout,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'

/**
 * Ring 5. What the notice says about **who** hosts the photograph, and where the guest can
 * read that operator's privacy policy (roadmap G2-17 / P3-18). The four answers about the
 * photograph itself are `GuestUploadPage.test.tsx`'s and `noticeWording.test.ts`'s.
 *
 * Two promises. A notice with no operator, on a box whose operator set no policy, is the
 * notice it always was — no extra line, no link. And a policy link is only ever an address
 * `useAbout` has already narrowed to https or a path on this site.
 */

const OPERATOR = 'Association Les Photographes'
const POLICY = 'https://hosted.example.org/legal/confidentialite'

const serving = (links: Record<string, string> = {}) =>
  fakeApi({ about: vi.fn(async () => anAbout({ links })) })

const policyLink = () => screen.queryByRole('link', { name: new RegExp(fr.about.privacyLink) })

const card = (operator?: string) => (
  <PrivacyNoticeCard
    state={aPrivacyNoticeState({
      acknowledgement: 'none',
      notice: aPrivacyNotice(operator === undefined ? {} : { operator }),
    })}
    onAcknowledge={() => undefined}
  />
)

describe('the privacy notice, naming the operator', () => {
  it('says "Hébergé par" with the operator’s name when the notice carries one', () => {
    renderWithProviders(card(OPERATOR), { api: serving() })

    const notice = within(screen.getByTestId('privacy-notice'))
    expect(notice.getByText(fr.about.operatorHostedBy)).toBeVisible()
    expect(notice.getByText(OPERATOR)).toBeVisible()
  })

  it('says nothing about a host on a notice that names none', () => {
    renderWithProviders(card(), { api: serving() })

    expect(screen.queryByText(fr.about.operatorHostedBy)).toBeNull()
  })

  it('renders the name as text and never as markup', () => {
    renderWithProviders(card('<img src=x onerror=alert(1)> Les Photographes'), { api: serving() })

    expect(screen.getByText(/<img src=x onerror=alert\(1\)> Les Photographes/)).toBeVisible()
    expect(document.querySelector('img')).toBeNull()
  })

  it.each(SUPPORTED_LOCALES)('labels the line in %s, the guest’s own language', (locale) => {
    renderWithProviders(card(OPERATOR), { api: serving(), locale })

    expect(screen.getByText(TRANSLATIONS[locale].about.operatorHostedBy)).toBeVisible()
    expect(screen.getByText(OPERATOR)).toBeVisible()
  })
})

describe('the privacy notice, linking the operator’s policy', () => {
  it('links the privacy policy when the operator set LEGAL_PRIVACY_URL', async () => {
    renderWithProviders(card(OPERATOR), { api: serving({ privacy: POLICY }) })

    await waitFor(() => expect(policyLink()).not.toBeNull())

    expect(policyLink()).toHaveAttribute('href', POLICY)
  })

  it('opens it in a tab of its own, so reading it cannot unmount a send in progress', async () => {
    renderWithProviders(card(OPERATOR), { api: serving({ privacy: POLICY }) })

    await waitFor(() => expect(policyLink()).not.toBeNull())

    expect(policyLink()).toHaveAttribute('target', '_blank')
    expect(policyLink()?.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
  })

  it('links a policy served from this site as the path it is', async () => {
    renderWithProviders(card(OPERATOR), { api: serving({ privacy: '/legal/confidentialite' }) })

    await waitFor(() => expect(policyLink()).not.toBeNull())

    expect(policyLink()).toHaveAttribute('href', '/legal/confidentialite')
  })

  it('offers no link on a box that set none, so a self-hoster’s notice is unchanged', async () => {
    const api = serving({})
    renderWithProviders(card(), { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(policyLink()).toBeNull()
    expect(within(screen.getByTestId('privacy-notice')).queryAllByRole('link')).toHaveLength(0)
  })

  it('links the policy even when the notice names no operator, since the link is the operator’s too', async () => {
    renderWithProviders(card(), { api: serving({ privacy: POLICY }) })

    await waitFor(() => expect(policyLink()).not.toBeNull())
  })

  it.each([
    ['a javascript: URI', 'javascript:alert(1)'],
    ['plain http', 'http://hosted.example.org/legal'],
    ['a protocol-relative address', '//evil.example/legal'],
  ])('never puts %s behind it, whatever the response says', async (_why, hostile) => {
    const api = serving({ privacy: hostile })
    renderWithProviders(card(OPERATOR), { api })

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(policyLink()).toBeNull()
  })

  it('says the same in the dialog that reopens the notice after it has been read', async () => {
    renderWithProviders(
      <PrivacyNoticeDialog
        notice={aPrivacyNotice({ operator: OPERATOR })}
        open
        onClose={() => undefined}
      />,
      { api: serving({ privacy: POLICY }) },
    )

    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(fr.about.operatorHostedBy)).toBeVisible()
    expect(dialog.getByText(OPERATOR)).toBeVisible()
    await waitFor(() =>
      expect(dialog.getByRole('link', { name: new RegExp(fr.about.privacyLink) })).toHaveAttribute(
        'href',
        POLICY,
      ),
    )
  })
})
