/**
 * The six pieces of the host's console that the operator's console uses as they are, and the one
 * place that says so.
 *
 * `eventslide-ui-component` says a feature never imports from another and that shared code moves to
 * `web/src/design-system/` or `web/src/lib/`. These six are shared code that has not moved yet:
 * the web review's cleanup (items W-06, W-08, W-13 and W-17) is moving the loader and the
 * async-state screens into `lib/`, the error sentence into `lib/i18n/` and the select and the
 * checkbox into the design system, and **each of those moves is somebody else's change in
 * flight**. Copying them here would be a seventh hand-rolled loader, and importing them at fifteen
 * sites would be fifteen edits when they move.
 *
 * So the exception is made once, here, and every file in this feature imports from this module:
 * when a move lands, this file is the only one that changes, and a lint rule that forbids
 * cross-feature imports has a single line to be told about.
 */
export { CheckboxField } from '../admin/components/CheckboxField'
export { LoadFailure, Pending } from '../admin/components/AsyncState'
export { SelectField } from '../admin/components/SelectField'
export { errorMessage } from '../admin/errorMessage'
export { useLoader } from '../admin/hooks/useLoader'
