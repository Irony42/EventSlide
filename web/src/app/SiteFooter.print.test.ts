import { describe, expect, it } from 'vitest'
import FOOTER_CSS from './SiteFooter.module.css?raw'
import FOOTER from './SiteFooter.tsx?raw'

/**
 * The support link does not go onto paper (roadmap G4-02).
 *
 * The host's event page prints its QR card for the tables ("print takes the QR card and
 * nothing else", `EventPage.module.css`), and the AppShell footer sits outside the columns
 * that page hides. So the sheet a host puts in front of the guests would end with an ask for
 * money, one the guests cannot act on and were never meant to read. jsdom has no print
 * media, so this reads the stylesheet the way `motion.budget.test.ts` reads every other one:
 * the rule is CSS, and the guard has to be about the CSS.
 *
 * (The source link, a licence offer that predates this, is left where it was.)
 */

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the footer’s support link on paper', () => {
  it('is hidden by an @media print rule on its own class', () => {
    expect(withoutComments(FOOTER_CSS)).toMatch(
      /@media\s+print\s*\{[^@]*\.support\s*\{[^}]*display\s*:\s*none/,
    )
  })

  it('wears that class, and only the support link does', () => {
    const uses = FOOTER.match(/styles\['support'\]/g) ?? []

    expect(uses).toHaveLength(1)
    // The one use is on the link that opens the donation page, not on the source offer.
    expect(FOOTER).toMatch(/href=\{links\.donate\}[^>]*styles\['support'\]/)
  })
})

/**
 * The operator's own links stay off paper too (roadmap G2-17): the same sheet, the same
 * reason. The terms, the privacy policy, the legal notice, the help page and the report link
 * are for someone at a screen, and a host prints this footer under the QR card for the tables.
 */
describe('the footer’s operator links on paper', () => {
  it('are hidden by an @media print rule on their own class', () => {
    expect(withoutComments(FOOTER_CSS)).toMatch(
      /@media\s+print\s*\{[^@]*\.operatorLink\s*\{[^}]*display\s*:\s*none/,
    )
  })

  it('all wear that class, and the source offer and the about link do not', () => {
    // One class on a shared constant, used by each of the five links: a sixth link added
    // beside them with `styles['link']` alone would print.
    expect(FOOTER.match(/className=\{operatorLink\}/g) ?? []).toHaveLength(5)
    expect(FOOTER.match(/styles\['operatorLink'\]/g) ?? []).toHaveLength(1)
    expect(FOOTER).toMatch(/href=\{sourceUrl\} className=\{styles\['link'\]\}/)
  })
})
