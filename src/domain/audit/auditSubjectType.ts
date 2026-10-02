/**
 * What an audit entry is about (roadmap §10.8; paid plan P3-07, free plan G2-06).
 *
 * The list is the `CHECK` on `audit_log.subject_type`, written once in each place and tied
 * together by `migrator.test.ts`, which inserts a row for every member and one for a word
 * that is not. It is wider than anything built today **on purpose**: widening a `CHECK` in
 * SQLite means rebuilding the table, and rebuilding an append-only table whose triggers
 * refuse every rewrite is the most expensive way there is to say "and also photos".
 *
 * - `photo` is for the moderation log of roadmap §5.4, which shares this storage.
 * - `report` is for a signalement about an event (G6-05).
 * - `access_request` is for the waiting list of G8-09. It may never be built; it is free
 *   now and a table rebuild later.
 */

export const AUDIT_SUBJECT_TYPES = [
  'client',
  'account',
  'invitation',
  'event',
  'photo',
  'report',
  'access_request',
] as const

export type AuditSubjectType = (typeof AUDIT_SUBJECT_TYPES)[number]

export const isAuditSubjectType = (value: unknown): value is AuditSubjectType =>
  typeof value === 'string' && (AUDIT_SUBJECT_TYPES as readonly string[]).includes(value)
