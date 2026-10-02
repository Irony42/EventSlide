import { useTranslations } from '../lib/i18n/useTranslations'
import { NewTabLink } from './NewTabLink'
import { useAbout } from './useAbout'
import styles from './SiteFooter.module.css'

/**
 * The footer of the guest and host screens, and the **AGPL section 13 source offer**
 * (roadmap G1-04 / P1-05): a user of a network service is entitled to the source of what
 * they are using, and this is where they are offered it.
 *
 * **There is deliberately no way to hide the link** — no prop, no setting, no flag on the
 * server. The operator can change *where* it points (`SOURCE_CODE_URL`); that it exists is
 * not theirs to configure, and a toggle added later is a licence breach, not a feature.
 * `router.test.tsx` and `tests/e2e/journeys/agpl-source-offer.spec.ts` are the guards.
 *
 * **Not on the wall.** `router.tsx` mounts it under the guest and host layouts only: the
 * projected screen is for the room, with nobody to click, and a line of small print on it
 * would be the one element in the frame that is not the party. The licence obligation is
 * to the people *using* the service, who are on the other two surfaces.
 *
 * Compact on purpose: it is on the upload screen too, under a composer that has to stay
 * where a thumb expects it.
 */
export function SiteFooter() {
  const text = useTranslations()
  const { sourceUrl } = useAbout()

  return (
    <footer className={styles['footer']}>
      <NewTabLink href={sourceUrl} className={styles['link']}>
        {text.about.sourceCode}
      </NewTabLink>
      <NewTabLink href="/about" className={styles['link']}>
        {text.about.aboutLink}
      </NewTabLink>
    </footer>
  )
}
