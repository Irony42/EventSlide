import { siteOverviewContract } from './contracts/siteOverviewContract'
import { FakeSiteOverview } from './fakeSiteOverview'

// The fake is its own world: it stores what the contract plants, content included, and
// derives the operator's rows from the part it may read. Everything it is asked is in the
// shared contract, which the SQLite adapter runs too.
siteOverviewContract('fake', async () => {
  const fake = new FakeSiteOverview()
  return { overview: fake, world: fake }
})
