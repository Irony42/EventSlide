import type { AboutDto, AboutFeaturesDto } from './dto'

/**
 * What the composition root knows about the running build, handed to the HTTP layer.
 *
 * `version` is `src/main/version.ts`'s answer and `sourceUrl` is `resolveSourceUrl`'s —
 * both resolved once at boot, because the interface layer may not import either module.
 */
export interface AboutFacts {
  readonly version: string
  readonly sourceUrl: string
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
 * Pure: the whole body is a function of two small records, so it can be tested without a
 * request. Nothing in it comes from the request — an instance-information answer that
 * varied by caller would have to be cached per caller, and this one is cached by everyone.
 */
export const toAboutDto = (facts: AboutFacts, features: AboutFeaturesDto): AboutDto => ({
  name: PRODUCT_NAME,
  version: facts.version,
  license: LICENSE,
  sourceUrl: facts.sourceUrl,
  links: {},
  features,
})
