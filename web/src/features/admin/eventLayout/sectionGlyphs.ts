import type { EventActionGlyph } from '../components/EventActionIcon'
import type { EventMoment, EventSection } from './eventSections'

/** Each section's glyph, drawn once in `EventActionIcon`. */
export const SECTION_GLYPH: Readonly<Record<EventSection, EventActionGlyph>> = {
  access: 'access',
  print: 'print',
  invitations: 'invitations',
  missions: 'missions',
  moderators: 'moderators',
  moderation: 'moderate',
  wall: 'wall',
  announcements: 'announcements',
  challenge: 'challenge',
  guestbook: 'guestbook',
  reveal: 'reveal',
  telegram: 'telegram',
  guests: 'guests',
  album: 'album',
  bestOf: 'bestOf',
  book: 'book',
  share: 'share',
  stats: 'stats',
  settings: 'settings',
}

export const MOMENT_GLYPH: Readonly<Record<EventMoment, EventActionGlyph>> = {
  before: 'before',
  during: 'during',
  after: 'after',
}
