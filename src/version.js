// `type` is 'patch' (default), 'minor', or 'major' — a minor bump resets
// patch to 0, a major bump resets minor and patch to 0, matching semver's
// own rule for what "the next minor/major" means.
export function bumpVersion(version, type = 'patch') {
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
