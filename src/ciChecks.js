import { gh } from './exec.js'

// Blocks until a PR's CI checks finish, so `bump --wait-checks` doesn't
// merge on top of a red build. Two steps rather than one:
//   1. A quick, quiet probe (no --watch) to see whether the PR has any
//      checks reported at all — most of these repos don't have CI wired up
//      yet, and "no checks configured" isn't a reason to refuse merging.
//   2. Only if checks exist: the real wait, using gh's own `--watch`
//      (rather than hand-rolled polling) with a real terminal so its live
//      updating table actually renders instead of arriving all at once
//      when it's done.
export function waitForChecks(repo, prNumber) {
  const probe = gh(repo.path, ['pr', 'checks', String(prNumber), '--json', 'bucket'], { quiet: true })
  if (!probe.ok || !probe.stdout || probe.stdout === '[]') {
    return { ok: true, skipped: true }
  }

  const watched = gh(repo.path, ['pr', 'checks', String(prNumber), '--watch', '--interval', '10'], {
    interactive: true,
  })
  if (watched.ok) return { ok: true, skipped: false }
  return {
    ok: false,
    message: `CI checks failed for PR #${prNumber} — not merging. Run \`gh pr checks ${prNumber}\` for details.`,
  }
}
