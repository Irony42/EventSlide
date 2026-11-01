/**
 * Who may be told that a fact happened.
 *
 * Every fact of the bus reaches both SSE channels of an event (the public wall's and the
 * moderation console's), because most of them are for everybody: a photo appeared, the event
 * closed. A few are for the host's console alone, and a room full of strangers must not learn
 * from the wall's stream that "the host is preparing a book". They are listed here, closed, and
 * **the public channel is the default**: a type that is not named is public, and a new private
 * type has to be added to this list to stay private (the test pins every member).
 */
export type SignalAudience = 'public' | 'moderation'

export const MODERATION_ONLY_SIGNALS: readonly string[] = ['book.changed']

export const canReceiveSignal = (type: string, audience: SignalAudience): boolean =>
  !MODERATION_ONLY_SIGNALS.includes(type)
