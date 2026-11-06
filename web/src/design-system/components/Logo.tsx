import { cx } from '../classNames'
import { WORDMARK_PATH } from './logoWordmark'
import styles from './Logo.module.css'

export interface LogoProps {
  /** `lockup` is the garland and the name, side by side; `mark` is the garland alone. */
  readonly variant?: 'lockup' | 'mark'
  /**
   * Which ink the name and the string are drawn in. `auto` follows the page's `color-scheme`
   * (cream on a dark ground, night on a light one), which is what a screen wants; `on-dark`
   * and `on-light` are for a mark set on a ground the page does not own, a light card on a
   * dark page for instance.
   */
  readonly tone?: 'auto' | 'on-dark' | 'on-light'
  readonly size?: 'sm' | 'md' | 'lg'
  /**
   * The mark beside words that already say the name (a heading, a link's own label): hidden
   * from assistive technology, so the name is not read twice. Left out, the logo is an image
   * named « EventSlide ».
   */
  readonly decorative?: boolean
  readonly className?: string | undefined
}

/** The three photos on the string, in the lockup's and the mark's own 100-unit box. */
function Photos() {
  return (
    <>
      <path
        className={styles['string']}
        d="M4 26Q50 58 96 26"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <g transform="rotate(16.99 22.4 36.24)">
        <rect className={styles['sun']} x="10.9" y="35.24" width="23" height="27" rx="3.5" />
        <rect className={styles['ink']} x="19.4" y="29.74" width="6" height="12" rx="2" />
      </g>
      <g transform="rotate(0 50 42)">
        <rect className={styles['coral']} x="36.5" y="41" width="27" height="32" rx="3.5" />
        <rect className={styles['ink']} x="47" y="35.5" width="6" height="12" rx="2" />
      </g>
      <g transform="rotate(-16.99 77.6 36.24)">
        <rect className={styles['sky']} x="66.1" y="35.24" width="23" height="27" rx="3.5" />
        <rect className={styles['ink']} x="74.6" y="29.74" width="6" height="12" rx="2" />
      </g>
    </>
  )
}

/**
 * EventSlide's logo, drawn inline so it takes its colours from the design tokens (`--brand-*`)
 * and costs no request: the brand kit's SVGs carry literal colours and a standalone file cannot
 * read a custom property.
 *
 * Surface: the screens that are the product's own, where no event is shown (sign-in, the host's
 * events list, À propos, the error and not-found pages) and the host console's header. Never the
 * guest's pages and never the wall: an event wears its own look there.
 *
 * The name « EventSlide » is a brand and is not translated.
 */
export function Logo({
  variant = 'lockup',
  tone = 'auto',
  size = 'md',
  decorative = false,
  className,
}: LogoProps) {
  const lockup = variant === 'lockup'
  const classes = cx(
    styles['logo'],
    styles[tone === 'auto' ? 'toneAuto' : tone === 'on-dark' ? 'toneDark' : 'toneLight'],
    styles[size],
    lockup ? styles['lockup'] : styles['mark'],
    className,
  )
  const accessibility = decorative
    ? { 'aria-hidden': true, focusable: false }
    : { role: 'img', 'aria-label': 'EventSlide' }

  return (
    <svg
      className={classes}
      viewBox={lockup ? '-8 -0.86 473.86 101.71' : '0 0 100 100'}
      xmlns="http://www.w3.org/2000/svg"
      {...accessibility}
    >
      {lockup ? (
        <>
          <g transform="translate(0 7.14) scale(1.22) translate(-1 -18)">
            <Photos />
          </g>
          <path className={styles['ink']} d={WORDMARK_PATH} />
        </>
      ) : (
        <Photos />
      )}
    </svg>
  )
}
