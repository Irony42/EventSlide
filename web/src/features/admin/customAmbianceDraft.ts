import type { EventThemeDto, ThemeCustom } from '../../lib/api/dto'

/**
 * The editor's draft, as pure functions (ADR 0011, decisions 6 and 7).
 *
 * The page holds two numbers, a polarity and a face; everything else a theme says is the
 * event's own and rides along untouched. Keeping the assembly here means the preview and the
 * save are built from the same value, so what the host sees is what `PATCH /settings` sends.
 */

/** The accepted range of both angles, mirrored from the domain. The server is the authority. */
export const HUE_MIN = 0
export const HUE_MAX = 359

/**
 * Where a host who has no Sur mesure yet starts: a dark ground (the room is dark), tinted
 * towards the product's own violet, wearing the faces of the ambiance the event wears now.
 */
export const initialCustom = (theme: EventThemeDto): ThemeCustom =>
  theme.custom ?? {
    ground: 'dark',
    groundHue: 265,
    faces: theme.ambiance === 'custom' ? 'eventslide' : theme.ambiance,
  }

/** The theme the previews wear and the save sends: the event's own, made Sur mesure. */
export const draftTheme = (
  base: EventThemeDto,
  custom: ThemeCustom,
  accentHue: number,
): EventThemeDto => ({ ...base, ambiance: 'custom', custom, accentHue })

/** What the draft was started from, flattened, so a refetch that changed nothing resets nothing. */
export const draftIdentity = (theme: EventThemeDto): string =>
  [
    theme.ambiance,
    theme.accentHue,
    theme.custom?.ground ?? '',
    theme.custom?.groundHue ?? '',
    theme.custom?.faces ?? '',
  ].join('|')
