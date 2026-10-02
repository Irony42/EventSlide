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
 * Third-party notices and the operator's identity will join it as the items that carry
 * them land (roadmap G1-07, G2-17); each adds a row here and nothing else.
 *
 * **The support section** (roadmap G4-02) is the one part that depends on the operator: it
 * is drawn only when the instance set `DONATION_URL` or `BUDGET_URL`, so a self-hosted box
 * reads the page as it always did. It says plainly that a donation unlocks nothing — the
 * same service for everyone — and it is a section of this page, never a banner over it.
 */
export function AboutPage() {
  const text = useTranslations()
  const about = useAbout()
  const { donate, budget } = about.links

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
