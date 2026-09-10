export function bumpBranchName(version, { scopedName } = {}) {
  return scopedName ? `${scopedName}-${version}-version-bump` : `${version}-version-bump`
}

// A branch name can technically contain "@" and "/", but a leading "@" is
// unusual and a "/" turns the name into a namespaced ref (git would then
// refuse to also have a branch literally named the part before the "/") —
// neither is worth the risk for something auto-generated, so a scoped
// package's name is flattened into one plain segment instead: the leading
// "@" of a scope is dropped and the "/" before the package name becomes a
// "-" (e.g. "@macrulez/inview-core" -> "macrulez-inview-core").
export function sanitizeBranchSegment(name) {
  return name.replace(/^@/, '').replace(/\//g, '-')
}

// Convenience wrapper for the common case — this package's own bump branch,
// scoped automatically when it's a pnpm workspace member (see repos.js's
// discoverPackages) so two packages in the same repo bumped to the same
// version number never collide on one branch name, unscoped (the original
// form, unchanged for every non-monorepo package) otherwise.
export function branchFor(repo, version) {
  return bumpBranchName(version, { scopedName: repo.isWorkspaceMember ? sanitizeBranchSegment(repo.name) : undefined })
}

// The inverse check — used by `doctor --clean-branches` to recognize a
// leftover bump branch among a repo's local branches without knowing which
// version (or, for a monorepo, which package) it was for. Matches whatever
// bumpBranchName can produce: a semver-ish version (optionally with a
// pre-release/build suffix, same as bumpVersion's output) followed by
// "-version-bump", either on its own (legacy, one-package-per-repo form) or
// prefixed with a package name and a "-" (the scoped form branchFor
// produces for a workspace member).
const BUMP_BRANCH_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-version-bump$/
const SCOPED_BUMP_BRANCH_PATTERN = /^[\w.@-]+-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-version-bump$/

export function isBumpBranchName(name) {
  return BUMP_BRANCH_PATTERN.test(name) || SCOPED_BUMP_BRANCH_PATTERN.test(name)
}
