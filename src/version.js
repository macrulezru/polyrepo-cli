export function bumpPatch(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/)
  if (!match) throw new Error(`Cannot parse version: ${version}`)
  const [, major, minor, patch, rest] = match
  return `${major}.${minor}.${Number(patch) + 1}${rest}`
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
