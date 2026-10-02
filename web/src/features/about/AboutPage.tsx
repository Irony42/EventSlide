import { NewTabLink } from '../../app/NewTabLink'
import { useAbout } from '../../app/useAbout'
import { Card } from '../../design-system/components/Card'
import { useTranslations } from '../../lib/i18n/useTranslations'
import styles from './AboutPage.module.css'

/**
 * `/about`: which build this is, under which licence, and where its source is (roadmap
 * G1-04 / P1-05) — the page behind the footer's "À propos", and the long form of the
 * AGPL section 13 offer the footer makes in one line.
 *
 * A guest surface in the reader's own language, and lazy: nobody needs it while
 * photographing a party, so the guest's eager chunk does not pay for it. It renders the
 * build's own version and source address at once and swaps in the server's when they
 * arrive (`useAbout`), so there is no loading state to show and no error to explain.
 *
 * Third-party notices will join it as the item that carries them lands (roadmap G1-07),
 * and adds a row here and nothing else.
 *
 * **The operator section** (roadmap G2-17 / P3-18) is drawn only when the operator named
 * themselves or set one of the pages they owe a visitor, so a self-hosted box reads the page
 * as it always did. It lists who runs the instance, how to reach them, and their terms,
 * privacy policy, legal notice and help page. The report link is not repeated here: the
 * footer under this page already carries it.
 *
 * **The support section** (roadmap G4-02) is the one part that depends on the operator: it
 * is drawn only when the instance set `DONATION_URL` or `BUDGET_URL`, so a self-hosted box
 * reads the page as it always did. It says plainly that a donation unlocks nothing — the
 * same service for everyone — and it is a section of this page, never a banner over it.
 */
export function AboutPage() {
  const text = useTranslations()
  const about = useAbout()
  const { donate, budget, terms, privacy, legalNotice, support } = about.links
  const { operator } = about
  const operatorLinks = [
    { href: terms, label: text.about.termsLink },
    { href: privacy, label: text.about.privacyLink },
    { href: legalNotice, label: text.about.legalNoticeLink },
    { href: support, label: text.about.helpLink },
  ].flatMap(({ href, label }) => (href === undefined ? [] : [{ href, label }]))

  return (
    <Card as="h1" title={text.about.title}>
      <p className={styles['intro']}>{text.about.intro}</p>
      <dl className={styles['facts']}>
        <div className={styles['fact']}>
          <dt>{text.about.versionLabel}</dt>
          <dd>{about.version}</dd>
        </div>
        <div className={styles['fact']}>
          <dt>{text.about.licenseLabel}</dt>
          <dd>{about.license}</dd>
        </div>
        <div className={styles['fact']}>
          <dt>{text.about.sourceLabel}</dt>
          <dd>
            <NewTabLink href={about.sourceUrl} className={styles['source']}>
              {about.sourceUrl}
            </NewTabLink>
            <span className={styles['note']}>{text.about.sourceNote}</span>
          </dd>
        </div>
      </dl>
      {operator === undefined && operatorLinks.length === 0 ? null : (
        <section className={styles['operator']} aria-labelledby="about-operator-title">
          <h2 className={styles['sectionTitle']} id="about-operator-title">
            {text.about.operatorTitle}
          </h2>
          {operator === undefined ? null : (
            <dl className={styles['facts']}>
              <div className={styles['fact']}>
                <dt>{text.about.operatorNameLabel}</dt>
                <dd>{operator.name}</dd>
              </div>
              {operator.contactEmail === undefined ? null : (
                <div className={styles['fact']}>
                  <dt>{text.about.operatorContactLabel}</dt>
                  <dd>
                    <a href={`mailto:${operator.contactEmail}`} className={styles['source']}>
                      {operator.contactEmail}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          )}
          <ul className={styles['supportLinks']}>
            {operatorLinks.map(({ href, label }) => (
              <li key={href}>
                <NewTabLink href={href} className={styles['supportLink']}>
                  {label}
                </NewTabLink>
              </li>
            ))}
          </ul>
        </section>
      )}
      {donate === undefined && budget === undefined ? null : (
        <section className={styles['support']} aria-labelledby="about-support-title">
          <h2 className={styles['supportTitle']} id="about-support-title">
            {text.about.supportTitle}
          </h2>
          <p className={styles['intro']}>{text.about.supportIntro}</p>
          {donate === undefined ? null : (
            <p className={styles['intro']}>{text.about.supportNoCounterpart}</p>
          )}
          <ul className={styles['supportLinks']}>
            {donate === undefined ? null : (
              <li>
                <NewTabLink href={donate} className={styles['supportLink']}>
                  {text.about.supportLink}
                </NewTabLink>
              </li>
            )}
            {budget === undefined ? null : (
              <li>
                <NewTabLink href={budget} className={styles['supportLink']}>
                  {text.about.budgetLink}
                </NewTabLink>
              </li>
            )}
          </ul>
        </section>
      )}
    </Card>
  )
}
