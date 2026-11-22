import type { ReactNode } from 'react'
import { AppearancePanel } from '../AppearancePanel'
import { useInviteLook } from '../useInvitePreferences'
import type { RenderPng } from './imageRender'
import type { InvitationTabProps, OutputProps } from './tabProps'

type OutputComponent = (props: OutputProps & { readonly renderPng?: RenderPng }) => ReactNode

/**
 * What the page does around a format, for a test of that format: it holds the look (read from and
 * kept on this device, as the page does), lays the appearance panel, the preview, the options and
 * the actions side by side, and nothing else.
 */
export function OutputHarness({
  Output,
  event,
  invite,
  renderPng,
}: InvitationTabProps & {
  readonly Output: OutputComponent
  readonly renderPng?: RenderPng | undefined
}) {
  const look = useInviteLook(event.slug)
  return (
    <Output
      event={event}
      invite={invite}
      preferences={look.preferences}
      onPreferences={look.update}
      photoUrl={look.photoUrl}
      {...(renderPng === undefined ? {} : { renderPng })}
    >
      {({ preview, options, actions }) => (
        <>
          <AppearancePanel event={event} invite={invite} look={look} />
          {preview}
          {options}
          {actions}
        </>
      )}
    </Output>
  )
}
