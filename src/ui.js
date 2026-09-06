import pc from 'picocolors'

// Column width/row-formatting is shared by `printTable` (the `list` output)
// and by the checkbox choice labels in `bump`/`switch-master`/`publish` —
// so a package name column lines up the same way whether it's shown in a
// static table or as a pickable list, instead of each command reinventing
// its own ad-hoc padding (which is how columns used to drift out of line
// once package names of different lengths were mixed in).
export function columnWidths(rows, columns) {
  return columns.map((col) =>
    Math.max(col.label?.length ?? 0, ...rows.map((row) => String(col.value(row)).length)),
  )
}

export function formatRow(row, columns, widths, separator = '  ') {
  return columns
    .map((col, i) => {
      const raw = String(col.value(row))
      const styled = col.style ? col.style(row, raw) : raw
      const pad = widths[i] - raw.length
      return styled + ' '.repeat(Math.max(pad, 0))
    })
    .join(separator)
}

// Minimal aligned-column table printer — no extra dependency needed for
// the handful of columns this CLI ever shows.
//
// `groupBy`, when given, inserts a blank line wherever its value changes
// between consecutive rows — used by `outdated`/`prs`, where several rows
// belong to the same package, to visually separate one package's rows from
// the next instead of everything running together. Rows are expected to
// already be grouped (i.e. sorted by whatever `groupBy` returns) — this
// only looks at adjacent rows, it doesn't sort.
export function printTable(rows, columns, { groupBy } = {}) {
  const widths = columnWidths(rows, columns)
  const header = columns.map((col, i) => (col.label ?? '').padEnd(widths[i])).join('  ')
  console.log('')
  console.log(pc.bold(header))
  console.log(pc.dim(widths.map((w) => '-'.repeat(w)).join('  ')))
  let lastGroup
  rows.forEach((row, i) => {
    if (groupBy) {
      const group = groupBy(row)
      if (i > 0 && group !== lastGroup) console.log('')
      lastGroup = group
    }
    console.log(formatRow(row, columns, widths))
  })
}

export function heading(text) {
  console.log('')
  console.log(pc.bold(pc.cyan(text)))
  console.log('')
}

export function stepHeading(index, total, label) {
  console.log('')
  console.log(pc.bold(pc.blue(`[${index}/${total}] ${label}`)))
}

export function ok(text) {
  console.log(pc.green(`  ✓ ${text}`))
}

export function fail(text) {
  console.log(pc.red(`  ✗ ${text}`))
}

export function warn(text) {
  console.log(pc.yellow(`  ! ${text}`))
}

// Shared theme for every `checkbox`/`select` prompt in this CLI:
//
// - `renderSelectedChoices` (checkbox only): the default collapses the
//   picked items into one comma-joined line once you confirm — unreadable
//   past a handful of packages. One per line instead.
// - `keysHelpTip`: both checkbox and select build their "↑↓ navigate •
//   space select • ⏎ submit"-style footer by calling this with their own
//   list of [key, action] pairs. Ctrl+C also cancels a prompt (it always
//   did — see the top-level ExitPromptError handler in index.js, which is
//   what stops that from crashing with a raw stack trace) but was never
//   listed here, so it looked unsupported. Appending it — with the exact
//   same bold-key/dim-action/dim-bullet styling @inquirer uses internally
//   — makes the footer match what the prompt actually accepts.
export const promptTheme = {
  style: {
    renderSelectedChoices: (selectedChoices) => selectedChoices.map((choice) => `\n    ${choice.name}`).join(''),
    keysHelpTip: (keys) =>
      [...keys, ['ctrl+c', 'cancel']].map(([key, action]) => `${pc.bold(key)} ${pc.dim(action)}`).join(pc.dim(' • ')),
  },
}
