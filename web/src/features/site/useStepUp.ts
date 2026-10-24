import { useContext } from 'react'
import { StepUpContext, type StepUp } from './stepUpContext'

/** The console's confirmation prompt. Mounted by `SiteLayout`, so every console screen has it. */
export const useStepUp = (): StepUp => {
  const stepUp = useContext(StepUpContext)
  if (stepUp === null) {
    throw new Error('useStepUp must be used inside a <StepUpProvider>. SiteLayout mounts it.')
  }
  return stepUp
}
