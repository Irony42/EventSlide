import { useTranslations } from '../lib/i18n/useTranslations'
import { NewTabLink } from './NewTabLink'
import { useAbout } from './useAbout'
import styles from './SiteFooter.module.css'

export interface SiteFooterProps {
  /**
   * Offer the "Soutenir le projet" link when the operator set `DONATION_URL` (roadmap
   * G4-02). **Off unless a layout turns it on**, and only `HostLayout` does: the guest's
   * screens, the upload screen above all, never carry it, because a guest with a phone in
   * one hand is not who is being asked and a link there is one brush away from losing a
   * send in progress. `router.test.tsx` guards each layout.
   */
  readonly supportLink?: boolean
  /**
   * Offer the host's help page when the operator set `SUPPORT_URL` (roadmap G2-17). Off
   * unless a layout turns it on, and only `HostLayout` does, on the same screens as
   * {@link supportLink}. Not the donation link: that one asks for money, this one answers a
   * host's question.
   */
  readonly helpLink?: boolean
  /**
   * Offer "Signaler un contenu" when the operator set `REPORT_URL` (roadmap G2-17 / P3-18,
   * DSA art. 16). Off unless a layout turns it on, and only `GuestLayout` does: the screens
   * where a stranger meets other people's photographs — joining, uploading, the shared
   * gallery. The host's console is not one of them, since a host moderates their own event.
   */
  readonly reportLink?: boolean
}

/**
 * The footer of the guest and host screens, and the **AGPL section 13 source offer**
 * (roadmap G1-04 / P1-05): a user of a network service is entitled to the source of what
 * they are using, and this is where they are offered it.
 *
 * **There is deliberately no way to hide the link** — no prop, no setting, no flag on the
 * server. The operator can change *where* it points (`SOURCE_CODE_URL`); that it exists is
 * not theirs to configure, and a toggle added later is a licence breach, not a feature.
 * `router.test.tsx` and `tests/e2e/agpl-source-offer.spec.ts` are the guards.
 *
 * **Not on the wall.** `router.tsx` mounts it under the guest and host layouts only: the
 * projected screen is for the room, with nobody to click, and a line of small print on it
 * would be the one element in the frame that is not the party. The licence obligation is
 * to the people *using* the service, who are on the other two surfaces.
 *
 * Compact on purpose: it is on the upload screen too, under a composer that has to stay
 * where a thumb expects it.
 *
 * **The support link is the opposite case**: optional, host surfaces only, and absent
 * unless the operator configured it. It is an addition to the footer and never a
 * substitute for the source link, which has no switch.
 *
 * **So are the operator's own links** (roadmap G2-17): the terms, the privacy policy and the
 * legal notice on every footer, the help page on the host's and "Signaler un contenu" on the
 * guests', each only where the operator set an address. A box that set none of them has the
 * two links it always had. They are hidden on paper, like the support link, because the host's
 * footer prints under the QR card for the tables.
 */
export function SiteFooter({
  supportLink = false,
  helpLink = false,
  reportLink = false,
}: SiteFooterProps) {
  const text = useTranslations()
  const { sourceUrl, links } = useAbout()
  const operatorLink = `${styles['link']} ${styles['operatorLink']}`

  return (
    <footer className={styles['footer']}>
      <NewTabLink href={sourceUrl} className={styles['link']}>
        {text.about.sourceCode}
      </NewTabLink>
      <NewTabLink href="/about" className={styles['link']}>
        {text.about.aboutLink}
      </NewTabLink>
      {links.terms === undefined ? null : (
        <NewTabLink href={links.terms} className={operatorLink}>
          {text.about.termsLink}
        </NewTabLink>
      )}
      {links.privacy === undefined ? null : (
        <NewTabLink href={links.privacy} className={operatorLink}>
          {text.about.privacyLink}
        </NewTabLink>
      )}
      {links.legalNotice === undefined ? null : (
        <NewTabLink href={links.legalNotice} className={operatorLink}>
          {text.about.legalNoticeLink}
        </NewTabLink>
      )}
      {helpLink && links.support !== undefined ? (
        <NewTabLink href={links.support} className={operatorLink}>
          {text.about.helpLink}
        </NewTabLink>
      ) : null}
      {reportLink && links.report !== undefined ? (
        <NewTabLink href={links.report} className={operatorLink}>
          {text.about.reportLink}
        </NewTabLink>
      ) : null}
      {supportLink && links.donate !== undefined ? (
        <NewTabLink href={links.donate} className={`${styles['link']} ${styles['support']}`}>
          {text.about.supportLink}
        </NewTabLink>
      ) : null}
    </footer>
  )
}
