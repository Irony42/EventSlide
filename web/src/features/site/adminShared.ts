/**
 * The six pieces of the host's console that the operator's console uses as they are, and the one
 * place that says so.
 *
 * `eventslide-ui-component` says a feature never imports from another and that shared code moves to
 * `web/src/design-system/` or `web/src/lib/`. These six were shared code that had not moved yet,
 * and the web review's cleanup is moving them one concern at a time: the loader (W-06) is now
 * `lib/useLoader.ts` and the async-state screens (W-08) are `design-system/components/Async.tsx`,
 * so those three re-exports point there; the select and the checkbox (W-17) are still the host
 * console's, and **that move is somebody else's change in flight**. (The error sentence has
 * already moved, to `messageForError` in `lib/i18n/translations.ts`, and this feature imports it
 * from there.) Copying them here would be a seventh hand-rolled loader, and importing them at
 * fifteen sites would be fifteen edits when they move.
 *
 * So the exception is made once, here, and every file in this feature imports from this module:
 * when a move lands, this file is the only one that changes, and a lint rule that forbids
 * cross-feature imports has a single line to be told about.
 */
export { CheckboxField } from '../admin/components/CheckboxField'
export { LoadFailure, Pending } from '../../design-system/components/Async'
export { SelectField } from '../admin/components/SelectField'
// Which clients the signed-in account belongs to: the console's header links to the client space
// when the operator has one (H9). The same hook the account menu reads.
export { useClientLimits } from '../admin/hooks/useClientLimits'
export { useLoader } from '../../lib/useLoader'
