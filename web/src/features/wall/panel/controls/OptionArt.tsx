import styles from './controls.module.css'

export type OptionArtName = 'counter' | 'signal' | 'fresh' | 'tilt' | 'time' | 'mixed' | 'guestbook'

/** A 48 x 36 sketch of the wall with the option's effect in the accent: decoration, never the name. */
export function OptionArt({ name }: { readonly name: OptionArtName }) {
  return (
    <svg className={styles['art']} viewBox="0 0 48 36" aria-hidden="true" focusable="false">
      {name === 'tilt' ? (
        <>
          <rect
            className={styles['artPhoto']}
            x="5"
            y="9"
            width="24"
            height="18"
            rx="2"
            transform="rotate(-8 17 18)"
          />
          <rect
            className={styles['artAccent']}
            x="20"
            y="9"
            width="24"
            height="18"
            rx="2"
            transform="rotate(7 32 18)"
          />
        </>
      ) : name === 'guestbook' ? (
        <>
          <rect className={styles['artAccent']} x="8" y="5" width="32" height="26" rx="3" />
          <path className={styles['artInk']} d="M13 14h22M13 20h22M13 26h12" />
        </>
      ) : name === 'mixed' ? (
        <>
          <rect className={styles['artPhoto']} x="4" y="6" width="18" height="11" rx="1.5" />
          <rect className={styles['artPhoto']} x="26" y="6" width="18" height="11" rx="1.5" />
          <rect className={styles['artAccent']} x="4" y="20" width="40" height="11" rx="1.5" />
        </>
      ) : (
        <>
          <rect className={styles['artPhoto']} x="6" y="6" width="36" height="24" rx="2" />
          {name === 'counter' ? (
            <rect className={styles['artAccent']} x="16" y="2" width="16" height="6" rx="3" />
          ) : null}
          {name === 'signal' ? (
            <circle className={styles['artAccent']} cx="38" cy="10" r="5" />
          ) : null}
          {name === 'fresh' ? (
            <rect className={styles['artAccent']} x="30" y="6" width="12" height="8" rx="2" />
          ) : null}
          {name === 'time' ? (
            <rect className={styles['artAccent']} x="8" y="24" width="14" height="4" rx="2" />
          ) : null}
        </>
      )}
    </svg>
  )
}
