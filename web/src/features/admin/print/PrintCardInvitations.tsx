import type { ReactNode } from 'react'
import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  isInvitationDesign,
  type InvitationDesign,
  type PrintDesign,
} from '../../../lib/print/printDesigns'
import type { DesignProps, PrintCardInvitation } from './PrintCard'
import { GarlandBanner, Photo } from './PrintCardParts'
import { ZIGZAG } from './printCardShapes'
import styles from './PrintCard.module.css'

/**
 * The invitation dispositions of the printed designs (spec 29): the same card as the table kit,
 * its slots filled with what an invitation says: the moment, the place **and its address** (paper
 * goes to the guests the host chose), the host's short word, the QR to the invitation page and the
 * short link under it. No steps and no join code: the QR leads to the invitation, which leads to
 * the wall on the evening.
 *
 * Every text is the host's, printed as written; the fixed words ("Invitation", "Date") come from
 * the language of the invitation, through the sheet's locale override.
 */

function useInvitation(props: DesignProps) {
  const { invitation } = props
  if (invitation === undefined) throw new Error('an invitation disposition needs its invitation')
  return invitation
}

/** The place and its address as one block: either half may be missing. */
function Place({
  venue,
  address,
}: {
  readonly venue: string | null
  readonly address: string | null
}) {
  return (
    <>
      {venue}
      {address === null ? null : <span className={styles['invAddr']}>{address}</span>}
    </>
  )
}

export function EssentielInvitation(props: DesignProps) {
  const { texts, qr } = props
  const invitation = useInvitation(props)
  return (
    <div className={styles['face']}>
      <p className={styles['esEye']}>{invitation.eyebrow}</p>
      <h2 className={styles['esInvTitle']} data-fit>
        {texts.title}
      </h2>
      <div className={styles['esRule']} />
      <div className={styles['esMoment']}>
        <p className={styles['esWhen']} data-fit>
          {invitation.day}
        </p>
        <p className={styles['esHours']}>{invitation.hours}</p>
      </div>
      {invitation.venue === null && invitation.address === null ? null : (
        <p className={styles['esWhere']} data-fit>
          {invitation.venue}
          {invitation.address === null ? null : (
            <span className={styles['esWhereAddress']}>{invitation.address}</span>
          )}
        </p>
      )}
      {invitation.message === null ? null : (
        <p className={styles['esMsg']} data-fit>
          {invitation.message}
          {invitation.more === null ? null : (
            <span className={styles['esMore']}>{invitation.more}</span>
          )}
        </p>
      )}
      {qr}
      <p className={styles['esLink']}>{invitation.link}</p>
    </div>
  )
}

/** The word of the host, and the line saying the rest is on the page. */
function Word({
  className,
  invitation,
}: {
  readonly className: string | undefined
  readonly invitation: PrintCardInvitation
}) {
  if (invitation.message === null) return null
  return (
    <p className={className} data-fit>
      {invitation.message}
      {invitation.more === null ? null : (
        <span className={styles['invMore']}>{invitation.more}</span>
      )}
    </p>
  )
}

/** The till receipt: the moment and the place as lines of the bill. */
export function TicketInvitation(props: DesignProps) {
  const t = useTranslations()
  const { texts, photoUrl, monogram, qr } = props
  const invitation = useInvitation(props)
  const rows: readonly (readonly [string, string])[] = [
    [t.printKit.dateLabel, invitation.dayShort],
    [t.guestInvite.card.hourLabel, invitation.hours],
    ...(invitation.venue === null
      ? []
      : ([[t.guestInvite.card.placeLabel, invitation.venue]] as const)),
  ]
  return (
    <div className={styles['face']}>
      <div className={styles['rcWrap']}>
        <div className={styles['rc']} style={{ clipPath: ZIGZAG }}>
          <h2 className={styles['rcTitle']} data-fit>
            {texts.title}
          </h2>
          <p className={styles['rcLine']} data-fit>
            {invitation.eyebrow}
          </p>
          {photoUrl === null ? (
            <div className={styles['rcGap']}>
              <span>{monogram}</span>
            </div>
          ) : (
            <Photo url={photoUrl} className={styles['rcPhoto']} />
          )}
          <div className={styles['rcSep']} />
          <div className={styles['rcItems']}>
            {rows.map(([label, value]) => (
              <p key={label}>
                <span>{label}</span>
                <i />
                <span>{value}</span>
              </p>
            ))}
          </div>
          {invitation.address === null ? null : (
            <p className={cx(styles['rcLine'], styles['invAddrLine'])}>{invitation.address}</p>
          )}
          <div className={styles['rcSep']} />
          <Word className={styles['rcTag']} invitation={invitation} />
          {qr}
          <p className={styles['rcLine']} data-fit>
            {invitation.link}
          </p>
        </div>
      </div>
    </div>
  )
}

/** The polaroids stuck on the page: the photo with the date for caption, the QR with "Scannez". */
export function SouvenirInvitation(props: DesignProps) {
  const t = useTranslations()
  const { texts, photoUrl, monogram, qr } = props
  const invitation = useInvitation(props)
  return (
    <div className={cx(styles['face'], styles['svFace'])}>
      <h2 className={styles['svTitle']} data-fit>
        {texts.title}
      </h2>
      <div className={cx(styles['polaroid'], styles['svPhoto'])}>
        <div className={cx(styles['tape'], styles['svTapeA'])} />
        {photoUrl === null ? (
          <div className={styles['pMono']}>{monogram}</div>
        ) : (
          <Photo url={photoUrl} />
        )}
        <span className={styles['hand']}>{invitation.dayShort}</span>
      </div>
      <div className={cx(styles['polaroid'], styles['svQr'])}>
        <div className={cx(styles['tape'], styles['svTapeB'])} />
        {qr}
        <span className={styles['hand']}>{t.printKit.scan}</span>
      </div>
      <div className={cx(styles['svNote'], styles['svNoteInv'])} data-fit>
        <p className={styles['invP']}>{invitation.hours}</p>
        {invitation.venue === null && invitation.address === null ? null : (
          <p className={styles['invP']}>
            <Place venue={invitation.venue} address={invitation.address} />
          </p>
        )}
        {invitation.message === null ? null : (
          <p className={styles['invP']}>
            {invitation.message}
            {invitation.more === null ? null : (
              <span className={styles['invMore']}>{invitation.more}</span>
            )}
          </p>
        )}
        <p className={cx(styles['invP'], styles['invLinkLine'])}>{invitation.link}</p>
      </div>
    </div>
  )
}

/** The guest's ticket: the photo, the title, the moment in three columns, the QR on the stub. */
export function BilletInvitation(props: DesignProps) {
  const t = useTranslations()
  const { texts, photoUrl, qr } = props
  const invitation = useInvitation(props)
  const card = t.guestInvite.card
  return (
    <div className={styles['face']}>
      <div className={styles['ti']}>
        <div className={styles['tiMain']}>
          <div className={styles['tiHead']}>
            <span>{t.printKit.ticketGuest}</span>
            <span>{card.entry}</span>
          </div>
          {photoUrl === null ? (
            <div className={cx(styles['tiPhoto'], styles['tiEmpty'])} />
          ) : (
            <Photo url={photoUrl} className={styles['tiPhoto']} />
          )}
          <h2 className={styles['tiTitle']} data-fit>
            {texts.title}
          </h2>
          <Word className={styles['tiTag']} invitation={invitation} />
          <div className={styles['tiInfo']}>
            <div>
              {t.printKit.dateLabel}
              <b>{invitation.dayShort}</b>
            </div>
            <div>
              {card.hourLabel}
              <b>{invitation.hours}</b>
            </div>
            <div>
              {card.placeLabel}
              <b>
                <Place venue={invitation.venue} address={invitation.address} />
              </b>
            </div>
          </div>
        </div>
        <div className={styles['tiCut']} />
        <div className={styles['tiStub']}>
          {qr}
          <div>
            <p className={styles['tiStubTitle']}>{t.printKit.scan}</p>
            <p className={styles['tiStubLine']}>{card.stubLine}</p>
            <p className={styles['invLink']}>{invitation.link}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The boarding pass: the start and the end of the evening for the route, the place for the gate. */
export function EmbarquementInvitation(props: DesignProps) {
  const t = useTranslations()
  const { texts, photoUrl, qr } = props
  const invitation = useInvitation(props)
  const card = t.guestInvite.card
  const [from = '', ...rest] = invitation.hours.split(' – ')
  const to = rest.length === 0 ? null : rest.join(' – ')
  return (
    <div className={styles['face']}>
      <div className={styles['bp']}>
        <div className={styles['bpHead']}>
          <span>✈ {t.printKit.boarding}</span>
          <span>{t.printKit.partyClass}</span>
        </div>
        <div className={styles['bpBody']}>
          <div className={styles['bpTop']}>
            <div className={styles['bpWindow']}>
              <Photo url={photoUrl} className={styles['bpView']} />
            </div>
            <div className={styles['bpRoute']}>
              <div className={styles['bpCodes']}>
                <span>{from}</span>
                {to === null ? null : <span aria-hidden="true">✈</span>}
                {to === null ? null : <span>{to}</span>}
              </div>
              <div className={styles['bpCities']}>
                <span>{card.startLabel}</span>
                {to === null ? null : <span>{card.endLabel}</span>}
              </div>
            </div>
          </div>
          <div>
            <p className={styles['bpLabel']}>{invitation.eyebrow}</p>
            <h2 className={styles['bpTitle']} data-fit>
              {texts.title}
            </h2>
          </div>
          <div className={styles['bpGrid']}>
            <div>
              <p className={styles['bpLabel']}>{t.printKit.dateLabel}</p>
              <b>{invitation.dayShort}</b>
            </div>
            <div>
              <p className={styles['bpLabel']}>{card.placeLabel}</p>
              <b>
                <Place venue={invitation.venue} address={invitation.address} />
              </b>
            </div>
          </div>
        </div>
        <div className={styles['bpCut']} />
        <div className={styles['bpStub']}>
          {qr}
          <div>
            <Word className={styles['bpWord']} invitation={invitation} />
            <p className={styles['invLink']}>{invitation.link}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The prints on a string, the title and the moment below, the QR hung on a second string. */
export function GuirlandeInvitation(props: DesignProps) {
  const { texts, photoUrl, monogram, qr } = props
  const invitation = useInvitation(props)
  return (
    <div className={cx(styles['face'], styles['glFace'])}>
      <GarlandBanner photoUrl={photoUrl} monogram={monogram} />
      <div className={cx(styles['col'], styles['glBody'])}>
        <h2 className={styles['glTitle']} data-fit>
          {texts.title}
        </h2>
        <p className={styles['glTag']} data-fit>
          {invitation.day} · {invitation.hours}
        </p>
        {invitation.venue === null && invitation.address === null ? null : (
          <p className={styles['glMeta']} data-fit>
            {[invitation.venue, invitation.address?.replace(/\s*\n\s*/g, ', ') ?? null]
              .filter((part) => part !== null)
              .join(' · ')}
          </p>
        )}
        <Word className={styles['glMsg']} invitation={invitation} />
        <div className={styles['glHang']}>
          <svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
            <path
              className={styles['glString']}
              d="M0 .6 Q50 7 100 .6"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className={styles['glQr']}>
            <div className={styles['glQrPeg']} />
            {qr}
          </div>
        </div>
        <p className={styles['invLink']}>{invitation.link}</p>
      </div>
    </div>
  )
}

/** The invitation dispositions: one per design that has one (`INVITATION_DESIGNS` in `printDesigns`). */
const LAYOUTS: Readonly<Record<InvitationDesign, (props: DesignProps) => ReactNode>> = {
  essentiel: EssentielInvitation,
  ticket: TicketInvitation,
  souvenir: SouvenirInvitation,
  billet: BilletInvitation,
  embarquement: EmbarquementInvitation,
  guirlande: GuirlandeInvitation,
}

/**
 * The invitation layout of a design; one it has none for is drawn with the Essentiel one, so a card
 * is never empty. `PrintCard` then wears Essentiel's stylesheet too.
 */
export function InvitationLayout({
  design,
  ...props
}: DesignProps & { readonly design: PrintDesign }) {
  const Layout = isInvitationDesign(design) ? LAYOUTS[design] : EssentielInvitation
  return <Layout {...props} />
}
