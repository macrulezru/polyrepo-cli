import semver from 'semver'

// Bump types that go through node-semver's own `inc` instead of the
// hand-rolled patch/minor/major logic below — semver.inc already knows how
// to advance (or start) a prerelease's numeric suffix, which the simple
// regex approach below doesn't attempt.
const SEMVER_INC_TYPES = new Set(['premajor', 'preminor', 'prepatch', 'prerelease'])

// `type` is 'patch' (default), 'minor', or 'major' — a minor bump resets
// patch to 0, a major bump resets minor and patch to 0, matching semver's
// own rule for what "the next minor/major" means. Any existing pre-release/
// build suffix is preserved as-is (not touched by semver's own rules on
// what a plain patch/minor/major bump does to a prerelease version) —
// that's deliberate here, see version.test.js.
//
// `type` can also be 'premajor'/'preminor'/'prepatch'/'prerelease' (paired
// with `options.preid`, e.g. 'alpha') to start or advance a prerelease, or
// 'custom' (with `options.customVersion`) to set an exact version instead
// of computing one — both delegate to node-semver, which already handles
// the prerelease-numbering rules correctly.
export function bumpVersion(version, type = 'patch', options = {}) {
  if (type === 'custom') {
    const parsed = semver.valid(options.customVersion)
    if (!parsed) throw new Error(`Not a valid semver version: ${options.customVersion}`)
    return parsed
  }

  if (SEMVER_INC_TYPES.has(type)) {
    const next = semver.inc(version, type, options.preid)
    if (!next) throw new Error(`Cannot parse version: ${version}`)
    return next
  }

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/)
  if (!match) throw new Error(`Cannot parse version: ${version}`)
  const [, major, minor, patch, rest] = match
  if (type === 'major') return `${Number(major) + 1}.0.0${rest}`
  if (type === 'minor') return `${major}.${Number(minor) + 1}.0${rest}`
  return `${major}.${minor}.${Number(patch) + 1}${rest}`
}

export function bumpPatch(version) {
  return bumpVersion(version, 'patch')
}

// Text-level replace (not JSON.parse + stringify) so formatting, key
// order, and quote style in package.json are left untouched — only the
// first "version" field (the top-level one) changes.
export function replaceVersionInText(text, newVersion) {
  let replaced = false
  const updated = text.replace(/"version"\s*:\s*"([^"]+)"/, (match) => {
    if (replaced) return match
    replaced = true
    return `"version": "${newVersion}"`
  })
  if (!replaced) throw new Error('No "version" field found in package.json')
  return updated
}
