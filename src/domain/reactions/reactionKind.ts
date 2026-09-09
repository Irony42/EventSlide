/**
 * The reactions a guest may send, as a closed set.
 *
 * Free text and an arbitrary emoji picker were both considered and rejected: whatever
 * a guest sends here is projected a metre tall in front of a family, and a wall that
 * can carry a message is no longer a photo wall. Five fixed buttons also mean the
 * guest flow never opens a keyboard, which is the whole point of the phone surface.
 *
 * This set is the contract shared by the phone, the wall and the `reactions` CHECK
 * constraint. Adding a kind is a migration, not a configuration change.
 */

export const REACTION_KINDS = ['love', 'laugh', 'wow', 'cheers', 'clap'] as const

export type ReactionKind = (typeof REACTION_KINDS)[number]

export const isReactionKind = (value: unknown): value is ReactionKind =>
  typeof value === 'string' && REACTION_KINDS.some((kind) => kind === value)

/**
 * How large a reaction starts when it floats up over the projected photo.
 *
 * The heart is the one people mean rather than aim for, and at eight metres a wall of
 * identically sized badges reads as noise, so it gets twice the area. This is
 * presentation only: `totalReactions` deliberately ignores it, because the photo of
 * the night must not be decided by which button is prettiest.
 */
const WEIGHTS: Readonly<Record<ReactionKind, number>> = {
  love: 2,
  laugh: 1,
  wow: 1,
  cheers: 1,
  clap: 1,
}

export const reactionWeight = (kind: ReactionKind): number => WEIGHTS[kind]
