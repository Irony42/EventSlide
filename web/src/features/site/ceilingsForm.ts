import type { CeilingsDto, SiteCeilingsPatch, SiteClientDefaultsDto } from '../../lib/api/dto'

/**
 * A client's ceilings as the console's form holds them: text boxes for the numbers, because a
 * number box cannot say "nothing here", and two switches.
 *
 * **This is view-state and a unit conversion, and no more.** Whether a ceiling is within the
 * catalogue's bounds is the server's, answered with its own code (`clientCeilings.*Invalid`), so
 * the only judgement made here is "is this text a number": the console never restates a bound it
 * would then have to keep in step with `domain/clients`.
 *
 * Storage is typed in decimal gigabytes (the unit `formatBytes` prints and a host's phone reports)
 * and travels as bytes.
 */
export interface CeilingFields {
  readonly maxEvents: string
  readonly maxEventsPerPeriod: string
  readonly maxTotalGigabytes: string
  readonly maxEventQuotaGigabytes: string
  readonly maxRetentionDays: string
  readonly maxLiveDays: string
  readonly clipsAllowed: boolean
  readonly liveAllowed: boolean
  /** Renew the period now: the one way the console moves `periodStartedAt`. */
  readonly renewPeriod: boolean
}

export type CeilingField = keyof CeilingFields

const BYTES_PER_GIGABYTE = 1_000_000_000

const countText = (value: number | null): string => (value === null ? '' : String(value))

/** Six decimals is a kilobyte's worth of precision, and a stored figure is never typed back. */
const gigabyteText = (bytes: number | null): string =>
  bytes === null ? '' : String(Number((bytes / BYTES_PER_GIGABYTE).toFixed(6)))

/** What `GET /api/site/clients` says of a client, or `GET /api/site/client-defaults` of a new one. */
type CeilingSource = Pick<
  CeilingsDto,
  | 'maxEvents'
  | 'maxEventsPerPeriod'
  | 'maxTotalBytes'
  | 'maxEventQuotaBytes'
  | 'maxRetentionDays'
  | 'maxLiveDays'
  | 'clipsAllowed'
> & { readonly liveAllowed?: boolean }

export const fieldsFromCeilings = (
  ceilings: CeilingSource | SiteClientDefaultsDto['ceilings'],
): CeilingFields => ({
  maxEvents: countText(ceilings.maxEvents),
  maxEventsPerPeriod: countText(ceilings.maxEventsPerPeriod),
  maxTotalGigabytes: gigabyteText(ceilings.maxTotalBytes),
  maxEventQuotaGigabytes: gigabyteText(ceilings.maxEventQuotaBytes),
  maxRetentionDays: countText(ceilings.maxRetentionDays),
  maxLiveDays: countText(ceilings.maxLiveDays),
  clipsAllowed: ceilings.clipsAllowed,
  // A new client may open: the defaults say nothing about it, and the catalogue's own default is on.
  liveAllowed: 'liveAllowed' in ceilings ? (ceilings.liveAllowed ?? true) : true,
  renewPeriod: false,
})

/** `null` for an empty box ("no ceiling"), `undefined` for text that is not a whole number. */
const parseCount = (text: string): number | null | undefined => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : undefined
}

/** Decimal gigabytes, with a comma or a full stop, to whole bytes. */
const parseGigabytes = (text: string): number | null | undefined => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return undefined
  const bytes = Math.round(Number(trimmed.replace(',', '.')) * BYTES_PER_GIGABYTE)
  return Number.isSafeInteger(bytes) ? bytes : undefined
}

export type PatchOutcome =
  | { readonly ok: true; readonly patch: SiteCeilingsPatch }
  | { readonly ok: false; readonly invalid: readonly CeilingField[] }

/**
 * The ceilings that **changed**, as the patch `PUT …/ceilings` and `POST /api/site/clients` take.
 *
 * Only a field whose text differs from `base` is sent. That is what keeps a stored figure exact
 * (a client at 5 368 709 120 bytes reads "5.36871" and is not rewritten as 5 368 710 000 because
 * somebody saved a reason), and it is what a patch means: a key left out keeps the client's value
 * and an explicit `null` removes the ceiling.
 */
export const ceilingsPatch = (
  next: CeilingFields,
  base: CeilingFields,
  now: () => Date,
): PatchOutcome => {
  const patch: { -readonly [Key in keyof SiteCeilingsPatch]: SiteCeilingsPatch[Key] } = {}
  const invalid: CeilingField[] = []

  const count = (
    field: 'maxEvents' | 'maxEventsPerPeriod' | 'maxRetentionDays' | 'maxLiveDays',
  ): void => {
    if (next[field] === base[field]) return
    const value = parseCount(next[field])
    if (value === undefined) invalid.push(field)
    else patch[field] = value
  }
  const gigabytes = (
    field: 'maxTotalGigabytes' | 'maxEventQuotaGigabytes',
    key: 'maxTotalBytes' | 'maxEventQuotaBytes',
  ): void => {
    if (next[field] === base[field]) return
    const value = parseGigabytes(next[field])
    if (value === undefined) invalid.push(field)
    else patch[key] = value
  }

  count('maxEvents')
  count('maxEventsPerPeriod')
  gigabytes('maxTotalGigabytes', 'maxTotalBytes')
  gigabytes('maxEventQuotaGigabytes', 'maxEventQuotaBytes')
  count('maxRetentionDays')
  count('maxLiveDays')
  if (next.clipsAllowed !== base.clipsAllowed) patch.clipsAllowed = next.clipsAllowed
  if (next.liveAllowed !== base.liveAllowed) patch.liveAllowed = next.liveAllowed
  if (next.renewPeriod) patch.periodStartedAt = now().toISOString()

  return invalid.length === 0 ? { ok: true, patch } : { ok: false, invalid }
}

export const isEmptyPatch = (patch: SiteCeilingsPatch): boolean => Object.keys(patch).length === 0
