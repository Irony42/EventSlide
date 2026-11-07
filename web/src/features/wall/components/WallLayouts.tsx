import type { WallLayout } from '../../../lib/api/dto'
import { wallLayoutPlaysVideo } from '../wallLayoutPlayback'
import { SendTimeContext } from './sendTimeContext'
import { SpotlightLayout } from './layouts/SpotlightLayout'
import { MosaicLayout } from './layouts/MosaicLayout'
import { PolaroidLayout } from './layouts/PolaroidLayout'
import { ClotheslineLayout } from './layouts/ClotheslineLayout'
import { FilmstripLayout } from './layouts/FilmstripLayout'
import { CollageLayout } from './layouts/CollageLayout'
import { SplitLayout } from './layouts/SplitLayout'
import type { LayoutViewProps } from './layouts/layoutProps'

export interface WallLayoutsProps extends Omit<LayoutViewProps, 'plays'> {
  /**
   * The layout to render, already resolved by `WallPage`. In order of precedence: the
   * `L` key's local override, then the display URL's `?layout=`, then the wall
   * response (the event's own choice when the host made one, spec 13).
   */
  readonly layout: WallLayout
}

/**
 * The layout switch.
 *
 * Every name in the contract now renders itself; the `never` assignment below means
 * adding another layout to `WallLayout` fails the build here instead of silently
 * showing the room black.
 *
 * It is also the **one** place that asks whether this layout plays video. Resolved here
 * and handed down, so the answer is the domain's spec at every slot on the wall rather
 * than six components each remembering the same rule — and so a seventh layout gets its
 * answer from the spec too, automatically, instead of from whichever branch somebody
 * copied.
 */
export function WallLayouts({ layout, showTime = false, ...view }: WallLayoutsProps) {
  return (
    <SendTimeContext.Provider value={showTime}>
      <LayoutSwitch layout={layout} {...view} />
    </SendTimeContext.Provider>
  )
}

function LayoutSwitch({ layout, ...view }: WallLayoutsProps) {
  const plays = wallLayoutPlaysVideo(layout)

  switch (layout) {
    case 'spotlight':
      return <SpotlightLayout {...view} plays={plays} />
    case 'mosaic':
      return <MosaicLayout {...view} plays={plays} />
    case 'polaroid':
      return <PolaroidLayout {...view} plays={plays} />
    case 'filmstrip':
      return <FilmstripLayout {...view} plays={plays} />
    case 'collage':
      return <CollageLayout {...view} plays={plays} />
    case 'split':
      return <SplitLayout {...view} plays={plays} />
    case 'clothesline':
      return <ClotheslineLayout {...view} plays={plays} />
    default: {
      const unhandled: never = layout
      return unhandled
    }
  }
}
