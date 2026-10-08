import pc from 'picocolors'
import { line } from './runtime.js'

// Same "--packages a,b,c" matching selectPackages.js uses to skip its
// checkbox, factored out for read-only commands (outdated, prs) that never
// show a checkbox at all — there's nothing to pick, just a report to
// narrow down. `names` undefined means "no filter, return everything".
export function filterByNames(items, names) {
  if (!names) return items
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))
  const selected = items.filter((r) => wanted.has(r.dir.toLowerCase()))
  const found = new Set(selected.map((r) => r.dir.toLowerCase()))
  for (const name of wanted) {
    if (!found.has(name)) line(pc.yellow(`Unknown package, ignoring: ${name}`))
  }
  return selected
}
