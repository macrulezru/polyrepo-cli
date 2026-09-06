import { checkbox } from '@inquirer/prompts'
import pc from 'picocolors'
import { promptTheme } from './ui.js'
import { filterByNames } from './filterByNames.js'

// Shared "pick some packages" step used by both `bump` and `publish`:
// either takes an explicit --packages list (skips the prompt entirely,
// warning about any name that doesn't match a discovered package) or shows
// an aligned-column checkbox. `buildChoice` receives the full item list
// (so column widths can be computed across all of them) and must return a
// per-item `(item) => choice` function.
export async function selectPackages({ items, packages, message, buildChoice, pageSize = 20 }) {
  if (packages) {
    return filterByNames(items, packages)
  }

  const makeChoice = buildChoice(items)
  const choices = items.map(makeChoice)

  // @inquirer/checkbox throws (not rejects — a synchronous throw, so the
  // top-level ExitPromptError handler in index.js never sees it) if every
  // choice is disabled — e.g. `polyrepo release` before anything has been
  // tagged yet. Callers that use `disabled` should really check for this
  // themselves with a message specific to why (see release.js), but this
  // is the backstop so a command that doesn't ends in a clean message
  // instead of a raw ValidationError stack trace.
  if (choices.length > 0 && choices.every((c) => c.disabled)) {
    console.log(pc.yellow('Nothing selectable — every item is disabled.'))
    return []
  }

  return checkbox({
    message,
    pageSize,
    theme: promptTheme,
    choices,
  })
}
