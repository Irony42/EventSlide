import { Link } from 'react-router-dom'
import { AmbianceSwatches } from '../controls/AmbianceSwatches'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import type { WallPanelContext, WallPanelSection } from '../panelTypes'

/**
 * "Ambiance" (order 20): the drawn ambiances. « Sur mesure » is made on its own page, so it is
 * listed only while it is the current one, and the link leads there.
 */
// The file exports a descriptor the registry collects, not its component.
// eslint-disable-next-line react-refresh/only-export-components
function AmbianceSection({ slug, settings, save }: WallPanelContext) {
  const t = useTranslations()
  const { theme } = settings
  return (
    <>
      <AmbianceSwatches
        value={theme.ambiance}
        onChange={(ambiance) => {
          // The theme is one decision and is replaced whole by the server: sent with its other
          // choices as they are, and without the custom object an ambiance other than `custom`
          // would be refused beside.
          save({
            theme: {
              accentHue: theme.accentHue,
              fonts: theme.fonts,
              frame: theme.frame,
              ambiance,
            },
          })
        }}
      />
      <p>
        <Link to={`/admin/events/${encodeURIComponent(slug)}/settings/ambiance`}>
          {theme.ambiance === 'custom' ? t.admin.customAmbianceEdit : t.admin.customAmbianceCreate}
        </Link>
      </p>
    </>
  )
}

export const section: WallPanelSection = {
  id: 'ambiance',
  order: 20,
  title: (text) => text.wall.panel.sectionAmbiance,
  icon: 'palette',
  summary: (text, { theme }) => text.admin.themeAmbianceNames[theme.ambiance],
  Component: AmbianceSection,
}
