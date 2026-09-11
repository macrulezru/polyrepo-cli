import fs from 'node:fs'
import semver from 'semver'

// Rewrites a stale dependency range the same way a person fixing it by hand
// would — keep the range's own style, just bump the number:
//   ^1.1.0  -> ^1.2.0
//   ~1.1.0  -> ~1.2.0
//   1.1.0   -> 1.2.0   (an exact pin stays exact)
// Anything else (a comparator range, an OR range, "*", a pre-1.0 caret's
// different meaning, etc. — none of them something `bump` itself ever
// produces, but nothing stops someone from hand-writing one) falls back to
// a caret range — always shown in a before/after preview before anything is
// written, so an unexpected fallback is visible, not silent.
export function updatedRange(oldRange, newVersion) {
  if (oldRange.startsWith('^')) return `^${newVersion}`
  if (oldRange.startsWith('~')) return `~${newVersion}`
  if (semver.valid(oldRange)) return newVersion
  return `^${newVersion}`
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Text-level replace (not JSON.parse + stringify, same reasoning as
// version.js's replaceVersionInText) so formatting, key order, and quote
// style elsewhere in package.json are left untouched. Matches the exact
// `"depName": "oldRange"` pair rather than assuming which of
// dependencies/devDependencies/peerDependencies it's in — findStaleLocalDeps
// already merged those three together, and a plain key+value match is
// enough to find the right spot regardless of which section it's actually
// declared in.
export function applyRangeUpdate(pkgPath, depName, oldRange, newRange) {
  const text = fs.readFileSync(pkgPath, 'utf8')
  const pattern = new RegExp(`("${escapeRegex(depName)}"\\s*:\\s*")${escapeRegex(oldRange)}(")`)
  if (!pattern.test(text)) {
    return {
      ok: false,
      message: `Could not find "${depName}": "${oldRange}" in package.json — it may have changed since this was checked.`,
    }
  }
  fs.writeFileSync(pkgPath, text.replace(pattern, `$1${newRange}$2`))
  return { ok: true }
}
