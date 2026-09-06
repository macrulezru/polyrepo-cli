export function bumpBranchName(version) {
  return `${version}-version-bump`
}

// The inverse check — used by `doctor --clean-branches` to recognize a
// leftover bump branch among a repo's local branches without knowing
// which version it was for. Matches whatever bumpBranchName can produce:
// a semver-ish version (optionally with a pre-release/build suffix, same
// as bumpVersion's output) followed by "-version-bump".
const BUMP_BRANCH_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-version-bump$/

export function isBumpBranchName(name) {
  return BUMP_BRANCH_PATTERN.test(name)
}
