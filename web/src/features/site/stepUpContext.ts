import { createContext } from 'react'

/**
 * What the console's writes ask of the person at the keyboard: *confirm yourself, then I carry on*.
 *
 * Every `/api/site` route that changes something answers `403 auth.stepUpRequired` unless the
 * session confirmed the person (password, and a code from the app where there is one) in the last
 * five minutes. A write that meets it calls `confirm()`: the answer is `true` once the server took
 * the confirmation, and `false` when the person gave up, in which case the write is not sent again.
 *
 * The context lives in its own module so that `StepUpProvider.tsx` exports a component and nothing
 * else, which keeps Fast Refresh working for that file.
 */
export interface StepUp {
  readonly confirm: () => Promise<boolean>
}

export const StepUpContext = createContext<StepUp | null>(null)
