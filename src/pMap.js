// Minimal concurrency-limited parallel map — no extra dependency needed for
// the one thing this CLI uses it for: fanning a read-only check (registry
// lookup, `git log`, branch/status) out across many repos at once instead
// of waiting on each one in turn. Order of results matches input order,
// regardless of which finishes first.
export async function pMap(items, mapper, concurrency = 8) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
