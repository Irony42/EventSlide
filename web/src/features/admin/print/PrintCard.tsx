import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  datePartOf,
  invitationQrShareOf,
  isInvitationDesign,
  monogramOf,
  qrShareOf,
  type PrintDesign,
} from '../../../lib/print/printDesigns'
import { InvitationLayout } from './PrintCardInvitations'
import { GarlandBanner, Photo } from './PrintCardParts'
import { ZIGZAG } from './printCardShapes'
import styles from './PrintCard.module.css'

/** What the host wrote: an empty title is the event's name by now, a `null` line the usual one. */
export interface PrintCardTexts {
  readonly title: string
  /** `null` prints the usual line, in the language of the evening. */
  readonly tagline: string | null
  readonly note: string | null
  readonly date: string | null
  readonly table: string | null
}

/**
 * What an invitation card says (spec 29), already in the language of the invitation: the date and
 * the hours in the zone of the party, the place and the address (**printed**: paper goes to guests
 * the host chose, unlike a story), the short word, a line saying the rest is on the page, and the
 * short readable link under the QR. The host's words are printed as written.
 */
export interface PrintCardInvitation {
  readonly eyebrow: string
  readonly day: string
  readonly hours: string
  readonly venue: string | null
  readonly address: string | null
  readonly message: string | null
  /** Set when the full word is longer than the one printed. */
  readonly more: string | null
  readonly link: string
  /** The day as numbers (`11/12/2027`), for the designs with a narrow column. */
  readonly dayShort: string
}

export interface PrintCardProps {
  readonly design: PrintDesign
  readonly texts: PrintCardTexts
  readonly steps: boolean
  /** A `data:` URL from `printPhoto`, or `null` for the design's own stand-in. */
  readonly photoUrl: string | null
  readonly focusX: number
  readonly focusY: number
  /** The QR, drawn by the sheet: the same element whatever the design. */
  readonly qr: ReactNode
  readonly joinCode: string
  readonly address: string | null
  /** An invitation card, not a table card: the design lays out its invitation disposition. */
  readonly invitation?: PrintCardInvitation | undefined
}

export interface DesignProps extends Omit<
  PrintCardProps,
  'design' | 'qr' | 'focusX' | 'focusY' | 'texts'
> {
  readonly texts: PrintCardTexts & { readonly tagline: string }
  readonly qr: ReactNode
  readonly monogram: string
}

/**
 * One printed card (spec 28): an A6 portrait drawn in `cqw`, so the same drawing serves the A5 and
 * the A4. The design decides where things go; the words around the host's own come from the
 * language of the evening, and the host's words are printed as written.
 *
 * Every title-like text carries `data-fit`: `useFitText` shrinks it until it fits its box, so a
 * long name never pushes the QR off the card.
 */
export function PrintCard({ design, qr, focusX, focusY, texts, ...rest }: PrintCardProps) {
  const t = useTranslations()
  // An invitation has its own disposition per design; a design with none wears the Essentiel one
  // **and its stylesheet**: the card is then an Essentiel one all the way down.
  const invitation = rest.invitation !== undefined
  const shown: PrintDesign = invitation && !isInvitationDesign(design) ? 'essentiel' : design
  const Design = DESIGNS[design]
  const style = {
    '--qr-share': String(
      invitation && isInvitationDesign(shown) ? invitationQrShareOf(shown) : qrShareOf(shown),
    ),
    '--fx': `${focusX}%`,
    '--fy': `${focusY}%`,
  } as CSSProperties
  const props = {
    ...rest,
    texts: { ...texts, tagline: texts.tagline ?? t.printKit.title },
    qr: <div className={styles['qr']}>{qr}</div>,
    monogram: monogramOf(texts.title),
  }
  return (
    <article className={cx(styles['card'], styles[shown])} data-print-card={shown} style={style}>
      {invitation ? <InvitationLayout design={design} {...props} /> : <Design {...props} />}
    </article>
  )
}

function Fallback({ joinCode, address }: Pick<DesignProps, 'joinCode' | 'address'>) {
  const t = useTranslations()
  return (
    <p className={styles['fallback']}>
      {address === null ? joinCode : t.printKit.fallback(joinCode, address)}
    </p>
  )
}

function Steps({ className }: { readonly className?: string | undefined }) {
  const t = useTranslations()
  return (
    <ol className={cx(styles['steps'], className)}>
      <li>{t.printKit.step1}</li>
      <li>{t.printKit.step2}</li>
      <li>{t.printKit.step3}</li>
    </ol>
  )
}

/** "date · table" on one line, either half absent. */
const metaLine = (date: string | null, table: string | null, tableWord: (name: string) => string) =>
  [date, table === null ? null : tableWord(table)].filter((part) => part !== null).join(' · ')

function Essentiel({ texts, steps, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  return (
    <div className={styles['face']}>
      {texts.date !== null || texts.table !== null ? (
        <div className={styles['esTop']}>
          <span>{texts.date}</span>
          <span className={styles['nowrap']}>
            {texts.table === null ? null : t.printKit.table(texts.table)}
          </span>
        </div>
      ) : null}
      <h2 className={styles['esTitle']} data-fit>
        {texts.title}
      </h2>
      <p className={styles['esTag']} data-fit>
        {texts.tagline}
      </p>
      {qr}
      {steps ? <Steps className={styles['esSteps']} /> : null}
      {texts.note === null ? null : <p className={styles['esNote']}>{texts.note}</p>}
      <Fallback joinCode={joinCode} address={address} />
    </div>
  )
}

function Classique({ texts, photoUrl, monogram, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  return (
    <div className={cx(styles['face'], styles['col'])}>
      <div className={styles['slot']}>
        {photoUrl === null ? (
          <div className={cx(styles['clOval'], styles['mono'])}>
            <span>{monogram}</span>
          </div>
        ) : (
          <Photo url={photoUrl} className={styles['clOval']} />
        )}
      </div>
      <h2 className={styles['clTitle']} data-fit>
        {texts.title}
      </h2>
      {texts.date === null ? null : <p className={styles['clDate']}>{texts.date}</p>}
      <div className={styles['clRule']} />
      <p className={styles['clTag']} data-fit>
        {texts.tagline}
      </p>
      {qr}
      {texts.table === null ? null : (
        <p className={styles['clTable']}>
          {t.printKit.tableLabel}
          <b>{texts.table}</b>
        </p>
      )}
      <Fallback joinCode={joinCode} address={address} />
    </div>
  )
}

function Ticket({ texts, photoUrl, monogram, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  const items = [t.printKit.receipt1, t.printKit.receipt2, t.printKit.receipt3, t.printKit.receipt4]
  return (
    <div className={styles['face']}>
      <div className={styles['rcWrap']}>
        <div className={styles['rc']} style={{ clipPath: ZIGZAG }}>
          <h2 className={styles['rcTitle']} data-fit>
            {texts.title}
          </h2>
          {texts.date === null ? null : (
            <p className={styles['rcLine']} data-fit>
              {texts.date}
            </p>
          )}
          {photoUrl === null ? (
            <div className={styles['rcGap']}>
              <span>{monogram}</span>
            </div>
          ) : (
            <Photo url={photoUrl} className={styles['rcPhoto']} />
          )}
          <div className={styles['rcSep']} />
          <div className={styles['rcItems']}>
            {items.map((item) => (
              <p key={item}>
                <span>1 × {item}</span>
                <i />
                <span>{t.printKit.price}</span>
              </p>
            ))}
          </div>
          <p className={styles['rcTotal']}>
            <span>{t.printKit.total}</span>
            <span>{t.printKit.unlimited}</span>
          </p>
          <div className={styles['rcSep']} />
          <p className={styles['rcTag']} data-fit>
            {texts.tagline}
          </p>
          {qr}
          <p className={styles['rcLine']} data-fit>
            {texts.table === null ? '' : `${t.printKit.table(texts.table)} · `}
            {t.printKit.receiptFoot}
          </p>
          <Fallback joinCode={joinCode} address={address} />
        </div>
      </div>
    </div>
  )
}

/** A comic "boom" burst. */
const STAR = (() => {
  const spikes = 14
  const points: string[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (Math.PI * i) / spikes
    const radius = i % 2 ? 34 : 50
    points.push(
      `${(50 + radius * Math.cos(angle)).toFixed(1)}% ${(50 + radius * Math.sin(angle)).toFixed(1)}%`,
    )
  }
  return `polygon(${points.join(',')})`
})()

function Bd({ texts, photoUrl, monogram, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  return (
    <div className={styles['face']}>
      <h2 className={styles['bdTitle']} data-fit>
        {texts.title}
      </h2>
      <div className={cx(styles['bdPanel'], styles['bdMain'])}>
        {photoUrl === null ? (
          <div className={styles['bdMono']}>{monogram}</div>
        ) : (
          <Photo url={photoUrl} />
        )}
        <div className={styles['bdBubble']}>
          <p data-fit>{texts.tagline}</p>
        </div>
      </div>
      <div className={styles['bdRow']}>
        <div className={cx(styles['bdPanel'], styles['bdQr'])}>{qr}</div>
        <div className={styles['bdSide']}>
          <div className={styles['bdBoom']} style={{ clipPath: STAR }}>
            <span style={{ clipPath: STAR }}>{t.printKit.boom}</span>
          </div>
          <p className={styles['bdCaption']} data-fit>
            {texts.table !== null
              ? t.printKit.meanwhileTable(texts.table)
              : (texts.date ?? t.printKit.meanwhile)}
          </p>
        </div>
      </div>
      <Fallback joinCode={joinCode} address={address} />
    </div>
  )
}

function Magazine({ texts, photoUrl, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  return (
    <div className={cx(styles['face'], styles['mgFace'])}>
      <Photo url={photoUrl} className={styles['mgPhoto']} />
      <div className={styles['mgShade']} />
      <div className={styles['mgTop']}>
        <h2 className={styles['mgTitle']} data-fit data-fit-min="9">
          {texts.title}
        </h2>
        <p className={styles['mgIssue']}>
          <span>{t.printKit.issue}</span>
          <span>{texts.date}</span>
        </p>
      </div>
      <div className={styles['mgPrice']}>
        <span>
          {t.printKit.freeIssue}
          <small>{t.printKit.forAll}</small>
        </span>
      </div>
      <div className={styles['mgLines']}>
        <p className={styles['mgKicker']}>{t.printKit.headline}</p>
        <p className={styles['mgBig']} data-fit>
          {texts.tagline}
        </p>
        {texts.note === null ? null : <p className={styles['mgNote']}>{texts.note}</p>}
      </div>
      {texts.table === null ? null : (
        <p className={styles['mgFoot']}>{t.printKit.table(texts.table)}</p>
      )}
      <div className={styles['mgBox']}>
        {qr}
        <p className={styles['mgCta']}>{t.printKit.coverCta}</p>
        <Fallback joinCode={joinCode} address={address} />
      </div>
    </div>
  )
}

function Souvenir({ texts, photoUrl, monogram, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
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
        <span className={styles['hand']}>
          {texts.date === null ? t.printKit.ourEvening : datePartOf(texts.date)}
        </span>
      </div>
      {texts.table === null ? null : (
        <div className={styles['svSticker']}>{t.printKit.table(texts.table)}</div>
      )}
      <div className={cx(styles['polaroid'], styles['svQr'])}>
        <div className={cx(styles['tape'], styles['svTapeB'])} />
        {qr}
        <span className={styles['hand']}>{t.printKit.scanMe}</span>
      </div>
      <div className={styles['svNote']} data-fit>
        <p>{texts.tagline}</p>
        {texts.note === null ? null : <p>{texts.note}</p>}
      </div>
      <Fallback joinCode={joinCode} address={address} />
    </div>
  )
}

function Postale({ texts, photoUrl, monogram, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  return (
    <div className={cx(styles['face'], styles['pcFace'])}>
      <div className={styles['pcFront']}>
        <Photo url={photoUrl} className={styles['pcFrontPhoto']} />
        <div className={styles['pcGreet']}>
          <span>{t.printKit.greetings}</span>
          <h2 className={styles['pcTitle']} data-fit>
            {texts.title}
          </h2>
        </div>
      </div>
      <div className={styles['pcBack']}>
        <div className={styles['pcMsg']}>
          <p>{texts.tagline}</p>
          {texts.note === null ? null : <p className={styles['pcNote']}>{texts.note}</p>}
          <p className={styles['pcSign']}>{t.printKit.seeYou}</p>
        </div>
        <div className={styles['pcRight']}>
          <div className={styles['pcStamps']}>
            <div className={styles['pcStamp']}>
              {photoUrl === null ? (
                <div className={styles['pcStampMono']}>{monogram}</div>
              ) : (
                <Photo url={photoUrl} />
              )}
            </div>
            <div className={styles['pcMark']}>
              <span>{texts.date === null ? t.printKit.toName : datePartOf(texts.date)}</span>
            </div>
          </div>
          <p className={styles['pcAddress']}>
            {t.printKit.toScreen}
            {texts.table === null ? null : (
              <>
                <br />
                {t.printKit.table(texts.table)}
              </>
            )}
          </p>
          {qr}
        </div>
        <Fallback joinCode={joinCode} address={address} />
      </div>
    </div>
  )
}

function Billet({ texts, photoUrl, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  return (
    <div className={styles['face']}>
      <div className={styles['ti']}>
        <div className={styles['tiMain']}>
          <div className={styles['tiHead']}>
            <span>{t.printKit.ticketGuest}</span>
            <span>{t.printKit.freeEntry}</span>
          </div>
          {photoUrl === null ? (
            <div className={cx(styles['tiPhoto'], styles['tiEmpty'])} />
          ) : (
            <Photo url={photoUrl} className={styles['tiPhoto']} />
          )}
          <h2 className={styles['tiTitle']} data-fit>
            {texts.title}
          </h2>
          <p className={styles['tiTag']} data-fit>
            {texts.tagline}
          </p>
          <div className={styles['tiInfo']}>
            <div>
              {t.printKit.dateLabel}
              <b>{texts.date === null ? t.printKit.tonight : datePartOf(texts.date)}</b>
            </div>
            <div>
              {t.printKit.tableLabel}
              <b>{texts.table ?? t.printKit.freeSeat}</b>
            </div>
            <div>
              {t.printKit.seatLabel}
              <b>{t.printKit.everywhere}</b>
            </div>
          </div>
        </div>
        <div className={styles['tiCut']} />
        <div className={styles['tiStub']}>
          {qr}
          <div>
            <p className={styles['tiStubTitle']}>{t.printKit.scan}</p>
            <p className={styles['tiStubLine']}>{t.printKit.stubLine}</p>
            <p className={styles['tiSerial']}>N° 000 142</p>
            <Fallback joinCode={joinCode} address={address} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Embarquement({ texts, steps, photoUrl, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
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
                <span>{t.printKit.fromCode}</span>
                <span aria-hidden="true">✈</span>
                <span>{t.printKit.toCode}</span>
              </div>
              <div className={styles['bpCities']}>
                <span>{t.printKit.fromName}</span>
                <span>{t.printKit.toName}</span>
              </div>
            </div>
          </div>
          <div>
            <p className={styles['bpLabel']}>{t.printKit.flight}</p>
            <h2 className={styles['bpTitle']} data-fit>
              {texts.title}
            </h2>
          </div>
          <div className={styles['bpGrid']}>
            <div>
              <p className={styles['bpLabel']}>{t.printKit.dateLabel}</p>
              <b>{texts.date === null ? t.printKit.tonight : datePartOf(texts.date)}</b>
            </div>
            <div>
              <p className={styles['bpLabel']}>{t.printKit.gate}</p>
              <b>{texts.table ?? t.printKit.allGates}</b>
            </div>
            <div>
              <p className={styles['bpLabel']}>{t.printKit.boardingTime}</p>
              <b>{t.printKit.now}</b>
            </div>
          </div>
        </div>
        <div className={styles['bpCut']} />
        <div className={styles['bpStub']}>
          {qr}
          <div>
            <p className={styles['bpCta']} data-fit>
              {texts.tagline}
            </p>
            {steps ? <p className={styles['bpSteps']}>{t.printKit.shortSteps}</p> : null}
            <Fallback joinCode={joinCode} address={address} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Jetable({ texts, photoUrl, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  return (
    <div className={cx(styles['face'], styles['col'], styles['jtFace'])}>
      <h2 className={styles['jtTitle']} data-fit>
        {texts.title}
      </h2>
      {texts.date === null ? null : (
        <p className={styles['jtDate']} data-fit>
          {texts.date}
        </p>
      )}
      <div className={styles['cam']}>
        <div className={styles['camButton']} />
        <div className={styles['camWheel']} />
        <div className={styles['camBody']} />
        <div className={styles['camView']} />
        <div className={styles['camFlash']} />
        <div className={cx(styles['camLens'], photoUrl === null && styles['camGlass'])}>
          <Photo url={photoUrl} className={styles['camLensPhoto']} />
        </div>
        <div className={styles['camLabel']}>
          <span>{t.printKit.shots}</span>
          <span>{texts.table === null ? t.printKit.partyIso : t.printKit.table(texts.table)}</span>
        </div>
      </div>
      <div className={styles['jtPrint']}>
        {qr}
        <p className={styles['jtCaption']} data-fit>
          {texts.tagline}
        </p>
      </div>
      <Fallback joinCode={joinCode} address={address} />
    </div>
  )
}

function Affiche({ texts, photoUrl, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  return (
    <div className={cx(styles['face'], styles['afFace'])}>
      <p className={styles['afTag']} data-fit>
        {texts.tagline}
      </p>
      <div className={styles['afMid']}>
        {photoUrl === null ? (
          <div className={cx(styles['afPhoto'], styles['afEmpty'])} />
        ) : (
          <Photo url={photoUrl} className={styles['afPhoto']} />
        )}
        <div className={styles['afQr']}>{qr}</div>
      </div>
      <div className={styles['afBottom']}>
        <h2 className={styles['afTitle']} data-fit>
          {texts.title}
        </h2>
        <p className={styles['afMeta']}>
          {texts.date}
          {texts.table === null ? null : (
            <>
              <br />
              {t.printKit.table(texts.table)}
            </>
          )}
        </p>
      </div>
      <Fallback joinCode={joinCode} address={address} />
    </div>
  )
}

/** Confetti on the edges only, the same on every card: a fixed draw, not a random one. */
const CONFETTI = (() => {
  let seed = 7
  const next = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const bits: { left: number; top: number; turn: number; kind: number }[] = []
  let guard = 0
  while (bits.length < 42 && guard++ < 2000) {
    const left = next() * 100
    const top = next() * 100
    if (left > 9 && left < 91 && top > 6 && top < 95) continue
    bits.push({ left, top, turn: Math.round(next() * 180), kind: bits.length })
  }
  return bits
})()

function Confettis({ texts, photoUrl, monogram, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  const meta = metaLine(texts.date, texts.table, t.printKit.table)
  return (
    <div className={cx(styles['face'], styles['col'], styles['cfFace'])}>
      <div className={styles['cfBits']} aria-hidden="true">
        {CONFETTI.map((bit) => (
          <i
            key={bit.kind}
            className={cx(styles[`cfShape${bit.kind % 3}`], styles[`cfColour${bit.kind % 5}`])}
            style={{
              left: `${bit.left.toFixed(1)}%`,
              top: `${bit.top.toFixed(1)}%`,
              rotate: `${bit.turn}deg`,
            }}
          />
        ))}
      </div>
      <h2 className={styles['cfTitle']} data-fit>
        {[...texts.title].map((letter, index) =>
          letter === ' ' ? ' ' : <span key={index}>{letter}</span>,
        )}
      </h2>
      <div className={styles['slot']}>
        {photoUrl === null ? (
          <div className={cx(styles['cfCircle'], styles['mono'])}>
            <span>{monogram}</span>
          </div>
        ) : (
          <Photo url={photoUrl} className={styles['cfCircle']} />
        )}
      </div>
      <p className={styles['cfTag']} data-fit>
        {texts.tagline}
      </p>
      <div className={styles['cfQr']}>{qr}</div>
      {meta === '' ? null : <p className={styles['cfMeta']}>{meta}</p>}
      <Fallback joinCode={joinCode} address={address} />
    </div>
  )
}

function Seventies({ texts, photoUrl, monogram, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  const meta = metaLine(texts.date, texts.table, t.printKit.table)
  return (
    <div className={cx(styles['face'], styles['col'], styles['seFace'])}>
      <div className={styles['seRainbow']}>
        <i className={styles['seBand1']} />
        <i className={styles['seBand2']} />
        <i className={styles['seBand3']} />
        <i className={styles['seBand4']} />
        {photoUrl === null ? (
          <div className={cx(styles['seCore'], styles['seMono'])}>{monogram}</div>
        ) : (
          <Photo url={photoUrl} className={styles['seCore']} />
        )}
      </div>
      <h2 className={styles['seTitle']} data-fit>
        {texts.title}
      </h2>
      <p className={styles['seTag']} data-fit>
        {texts.tagline}
      </p>
      <div className={styles['seQr']}>{qr}</div>
      {meta === '' ? null : (
        <p className={styles['seMeta']} data-fit>
          {meta}
        </p>
      )}
      <Fallback joinCode={joinCode} address={address} />
      <div className={styles['seStripes']} />
    </div>
  )
}

function Nuit({ texts, photoUrl, monogram, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  const meta = metaLine(texts.date, texts.table, t.printKit.table)
  return (
    <div className={cx(styles['face'], styles['col'], styles['nuFace'])}>
      <h2 className={styles['nuTitle']} data-fit>
        {texts.title}
      </h2>
      <p className={styles['nuTag']} data-fit>
        {texts.tagline}
      </p>
      <div className={styles['slot']}>
        {photoUrl === null ? (
          <div className={styles['nuMono']}>{monogram}</div>
        ) : (
          <Photo url={photoUrl} className={styles['nuPhoto']} />
        )}
      </div>
      <div className={styles['nuQr']}>{qr}</div>
      {meta === '' ? null : <p className={styles['nuMeta']}>{meta}</p>}
      <Fallback joinCode={joinCode} address={address} />
    </div>
  )
}

function Guirlande({ texts, photoUrl, monogram, qr, joinCode, address }: DesignProps) {
  const t = useTranslations()
  const meta = metaLine(texts.date, texts.table, t.printKit.table)
  return (
    <div className={cx(styles['face'], styles['glFace'])}>
      <GarlandBanner photoUrl={photoUrl} monogram={monogram} />
      <div className={cx(styles['col'], styles['glBody'])}>
        <h2 className={styles['glTitle']} data-fit>
          {texts.title}
        </h2>
        <p className={styles['glTag']} data-fit>
          {texts.tagline}
        </p>
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
        {meta === '' ? null : (
          <p className={styles['glMeta']} data-fit>
            {meta}
          </p>
        )}
        <Fallback joinCode={joinCode} address={address} />
      </div>
    </div>
  )
}

const DESIGNS: Readonly<Record<PrintDesign, (props: DesignProps) => ReactNode>> = {
  essentiel: Essentiel,
  classique: Classique,
  ticket: Ticket,
  bd: Bd,
  magazine: Magazine,
  souvenir: Souvenir,
  postale: Postale,
  billet: Billet,
  embarquement: Embarquement,
  jetable: Jetable,
  affiche: Affiche,
  confettis: Confettis,
  seventies: Seventies,
  nuit: Nuit,
  guirlande: Guirlande,
}
