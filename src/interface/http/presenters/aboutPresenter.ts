import type { AboutDto, AboutFeaturesDto, AboutLinksDto, AboutOperatorDto } from './dto'

/**
 * What the composition root knows about the running build, handed to the HTTP layer.
 *
 * `version` is `src/main/version.ts`'s answer and `sourceUrl` is `resolveSourceUrl`'s —
 * both resolved once at boot, because the interface layer may not import either module.
 * `operator` and `links` are what the operator configured (roadmap G4-02, G2-17): the name
 * and contact address, and the seven links, each `null` where they set nothing.
 */
export interface AboutFacts {
  readonly version: string
  readonly sourceUrl: string
  /** `OPERATOR_NAME` and `OPERATOR_CONTACT_EMAIL`; `null` on a box that named nobody. */
  readonly operator: {
    readonly name: string
    readonly contactEmail: string | null
  } | null
  readonly links: {
    readonly donate: string | null
    readonly budget: string | null
    readonly terms: string | null
    readonly privacy: string | null
    readonly legalNotice: string | null
    readonly support: string | null
    readonly report: string | null
  }
}

/** The product's name as a client prints it. The one place it is written for the wire. */
const PRODUCT_NAME = 'EventSlide'

/**
 * The licence, as an SPDX identifier. Held to `package.json`'s `license` field by
 * `aboutRoutes.test.ts`: the type narrows it to the one value this product is under, so a
 * relicence is a compile error here before it is a wrong answer on a public endpoint.
 */
const LICENSE = 'AGPL-3.0-only'

/**
 * A link is on the wire only when the operator set it: an unset one is **absent**, never
 * `null` and never an empty string, so a client's `if (links.donate)` and a self-hoster's
 * empty `links: {}` are the same statement.
 */
const presentLinks = (links: AboutFacts['links']): AboutLinksDto => ({
  ...(links.terms === null ? {} : { terms: links.terms }),
  ...(links.privacy === null ? {} : { privacy: links.privacy }),
  ...(links.legalNotice === null ? {} : { legalNotice: links.legalNotice }),
  ...(links.support === null ? {} : { support: links.support }),
  ...(links.report === null ? {} : { report: links.report }),
  ...(links.donate === null ? {} : { donate: links.donate }),
  ...(links.budget === null ? {} : { budget: links.budget }),
})

/**
 * The operator, when there is one. The contact address rides on the name and nowhere else:
 * an address with no one behind it is not published, because it has no place in the shape.
 */
const presentOperator = (operator: AboutFacts['operator']): AboutOperatorDto | undefined =>
  operator === null
    ? undefined
    : {
        name: operator.name,
        ...(operator.contactEmail === null ? {} : { contactEmail: operator.contactEmail }),
      }

/**
 * Pure: the whole body is a function of two small records, so it can be tested without a
 * request. Nothing in it comes from the request — an instance-information answer that
 * varied by caller would have to be cached per caller, and this one is cached by everyone.
 */
export const toAboutDto = (facts: AboutFacts, features: AboutFeaturesDto): AboutDto => {
  const operator = presentOperator(facts.operator)
  return {
    name: PRODUCT_NAME,
    version: facts.version,
    license: LICENSE,
    sourceUrl: facts.sourceUrl,
    ...(operator === undefined ? {} : { operator }),
    links: presentLinks(facts.links),
    features,
  }
}
