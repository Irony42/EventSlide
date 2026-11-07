// `joinHost` moved to `lib/joinHost.ts` (WEB-HOST-04) so the host console can use it without importing the
// wall. The wall still imports this path; delete this file when it imports the lib module itself.
export { joinHost } from '../../lib/joinHost'
