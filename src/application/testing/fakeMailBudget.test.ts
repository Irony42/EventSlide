import { mailBudgetContract } from './contracts/mailBudgetContract'
import { FakeMailBudget } from './fakeMailBudget'

mailBudgetContract('fake', async (maxPerDay) => ({ budget: new FakeMailBudget(maxPerDay) }))
