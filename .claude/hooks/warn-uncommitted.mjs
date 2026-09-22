/**
 * Say out loud, when a turn ends, that work is sitting uncommitted.
 *
 * Three times in one week an agent was killed by its session ending with everything it
 * had written still in the working tree: a finished roadmap item that had never been
 * committed, a half-regenerated set of visual baselines, and a triage caught part-way
 * through. Nothing was lost, but only because somebody noticed and committed the tree by
 * hand before touching anything else. The published failure mode for this has a name —
 * runs get abandoned when nobody owns the result — and a dirty tree at the end of a turn
 * is what it looks like from the inside.
 *
 * So this is a reminder, not a gate. It cannot commit for you: a commit is a judgement
 * about what the change is, and a hook has no business making it. It cannot block either,
 * because an uncommitted tree mid-task is normal and a hook that nags on every turn is a
 * hook somebody deletes.
 *
 * It fires only when the tree is dirty *and* the branch is not `main`, which is the shape
 * of "an agent was working on something and stopped". A WIP commit that says plainly it
 * is not landable beats a tree that evaporates.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const git = async (...args) => {
  const { stdout } = await run('git', args, { cwd: process.cwd(), windowsHide: true })
  return stdout.trim()
}

const main = async () => {
  const [status, branch] = await Promise.all([
    git('status', '--porcelain'),
    git('rev-parse', '--abbrev-ref', 'HEAD'),
  ])

  if (status === '' || branch === 'main') return

  const lines = status.split('\n').filter(Boolean)
  const untracked = lines.filter((line) => line.startsWith('??')).length
  const tracked = lines.length - untracked

  console.error(
    [
      `${lines.length} uncommitted file(s) on ${branch} — ${tracked} modified, ${untracked} untracked.`,
      'If this work should survive the session, commit it now, even as WIP that says so in',
      'its message. Three agents lost a tree this way; every one was recoverable only',
      'because a human committed it before doing anything else.',
    ].join('\n'),
  )
}

main().catch(() => {
  // Not a git worktree, git missing, detached in a way rev-parse dislikes — all fine.
  // This hook is a courtesy and must never be the reason a turn reports a failure.
})
