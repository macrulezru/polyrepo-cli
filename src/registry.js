import { npmAsync } from './exec.js'

// Read-only registry lookup — `npm view <name> version`. Returns null both
// for "never published" (npm exits with E404) and for any other lookup
// failure (offline, registry hiccup); either way the safe default is to
// treat the package as needing a look before publishing.
export async function fetchPublishedVersionAsync(repo) {
  const result = await npmAsync(repo.path, ['view', repo.name, 'version'])
  return result.ok ? result.stdout || null : null
}
