import { RevealBanner } from '../RevealBanner'
import { RevealPanel } from '../RevealPanel'
import { useRevealControl } from '../useRevealControl'
import type { EventDto } from '../../../lib/api/dto'

export interface RevealControlsProps {
  readonly event: EventDto
  readonly onChanged: (event: EventDto) => void
  readonly onReload: () => void
  readonly settingsPath: string | null
  readonly withBanner: boolean
}

/** What the event page does with the reveal: one state, the banner on top, the section, one dialog. */
export function RevealControls({
  event,
  onChanged,
  onReload,
  settingsPath,
  withBanner,
}: RevealControlsProps) {
  const control = useRevealControl({ event, onChanged, onReload })
  return (
    <>
      {withBanner ? <RevealBanner control={control} /> : null}
      <RevealPanel control={control} settingsPath={settingsPath} />
      {control.dialog}
    </>
  )
}
