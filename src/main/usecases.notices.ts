import {
  makeGetMailPreferences,
  makeSetMailPreferences,
} from '../application/usecases/notices/mailPreferences'
import { makePruneMailBudget } from '../application/usecases/notices/pruneMailBudget'
import type { Adapters, UseCasePolicy } from './usecases'

/**
 * The host-mail slice of the use-case bag (spec 32, ADR 0019): composition only, built by `buildUseCases`.
 *
 * Built whatever `HOST_MAIL_NOTICES` says, like every use case: an account's two switches are stored even
 * on a box that sends nothing (so what the host chose survives the day a relay is configured), and
 * `available` tells the page whether they mean anything now. `pruneMailBudget` has no route: the
 * retention sweep calls it.
 */
export const noticeUseCases = (adapters: Adapters, policy: UseCasePolicy) => ({
  getMailPreferences: makeGetMailPreferences({
    users: adapters.users,
    preferences: adapters.mailPreferences,
    mailer: adapters.mailer,
    hostMailNotices: policy.hostMailNotices,
  }),
  setMailPreferences: makeSetMailPreferences({
    users: adapters.users,
    preferences: adapters.mailPreferences,
    audit: adapters.audit,
    clock: adapters.clock,
  }),
  pruneMailBudget: makePruneMailBudget({ budget: adapters.mailBudget, clock: adapters.clock }),
})
