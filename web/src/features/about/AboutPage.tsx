import { NewTabLink } from '../../app/NewTabLink'
import { useAbout } from '../../app/useAbout'
import { Card } from '../../design-system/components/Card'
import { useTranslations } from '../../lib/i18n/useTranslations'
import styles from './AboutPage.module.css'

/**
 * Where the build puts the notices (`NOTICES_FILE` in `web/thirdPartyNotices.ts`, which
 * the browser bundle may not import: it reads the disk). `scripts/thirdPartyNotices.test.ts`
 * holds the two spellings together, and `tests/e2e/agpl-source-offer.spec.ts` follows the
 * link on a real server.
 */
const THIRD_PARTY_NOTICES_URL = '/third-party-licenses.txt'

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
 * **The third-party licences row** (roadmap G1-07 / P1-09) links the notices of the libraries
 * the JavaScript contains, which the build writes beside the bundle
 * (`web/thirdPartyNotices.ts`) and the server sends as a plain static file. It is a row of
 * this page rather than a third link in the footer: the footer is one line under the upload
 * composer, and this is where a reader who wants the licences goes after "À propos".
 * The operator's identity will join it when G2-17 lands, as a row here and nothing else.
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
        <div className={styles['fact']}>
          <dt>{text.about.noticesLabel}</dt>
          <dd>
            <NewTabLink href={THIRD_PARTY_NOTICES_URL} className={styles['source']}>
              {text.about.noticesLink}
            </NewTabLink>
            <span className={styles['note']}>{text.about.noticesNote}</span>
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
