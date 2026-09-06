import fs from 'node:fs'
import path from 'node:path'
import { columnWidths } from './ui.js'

// Reuses the exact columns/rows already computed for the terminal table —
// what gets saved to a file is always what you'd have seen on screen (same
// --quick/--path choices), not a separate export-only data shape.
function toRecords(rows, columns) {
  return rows.map((row) => Object.fromEntries(columns.map((col) => [col.label, String(col.value(row))])))
}

// A cell that's exactly the checkmark/cross the terminal table uses for a
// plain yes/no fact (e.g. Release, or npm when it's up to date) becomes a
// real boolean here — JSON is for machines, "✓" isn't a value a JSON
// consumer can branch on without string-matching it back out. Everything
// else (an actual outdated registry version, "⚠ N" stale deps, "clean"/
// "dirty", "—" for not-applicable) carries more information than a plain
// yes/no and stays as text — collapsing those to booleans would throw
// real data away, not just reformat it.
function toJsonValue(text) {
  if (text === '✓') return true
  if (text === '✗') return false
  return text
}

function formatAsJson(rows, columns) {
  const records = rows.map((row) =>
    Object.fromEntries(columns.map((col) => [col.label, toJsonValue(String(col.value(row)))])),
  )
  return JSON.stringify(records, null, 2) + '\n'
}

function formatAsMarkdown(rows, columns) {
  const headers = columns.map((c) => c.label)
  const escape = (v) => v.replace(/\|/g, '\\|')
  const records = toRecords(rows, columns)
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...records.map((r) => `| ${headers.map((h) => escape(r[h])).join(' | ')} |`),
  ]
  return lines.join('\n') + '\n'
}

// Same aligned-column layout `printTable` prints to the terminal, minus the
// ANSI color codes `col.style` would add — a plain-text file shouldn't be
// full of escape sequences.
function formatAsText(rows, columns) {
  const widths = columnWidths(rows, columns)
  const header = columns.map((col, i) => col.label.padEnd(widths[i])).join('  ')
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')
  const lines = [header, separator, ...rows.map((row) => columns.map((col, i) => String(col.value(row)).padEnd(widths[i])).join('  '))]
  return lines.join('\n') + '\n'
}

// RFC 4180: a field only needs quoting when it contains a comma, a quote,
// or a newline — quoting everything unconditionally would still be valid
// CSV, but leaves the common case (plain version numbers, branch names)
// needlessly noisy to read.
function csvEscape(value) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function formatAsCsv(rows, columns) {
  const headers = columns.map((c) => c.label)
  const records = toRecords(rows, columns)
  const lines = [
    headers.map(csvEscape).join(','),
    ...records.map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
  ]
  return lines.join('\n') + '\n'
}

function htmlEscape(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// A standalone document (not just a bare <table> fragment) so --output
// report.html is directly openable in a browser and still readable, not
// just an unstyled table dumped on a blank page.
function formatAsHtml(rows, columns) {
  const headers = columns.map((c) => c.label)
  const records = toRecords(rows, columns)
  const theadCells = headers.map((h) => `<th>${htmlEscape(h)}</th>`).join('')
  const bodyRows = records
    .map((r) => `    <tr>${headers.map((h) => `<td>${htmlEscape(r[h])}</td>`).join('')}</tr>`)
    .join('\n')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>polyrepo list</title>
<style>
  table { border-collapse: collapse; font-family: monospace; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  th { background: #eee; }
</style>
</head>
<body>
<table>
  <thead><tr>${theadCells}</tr></thead>
  <tbody>
${bodyRows}
  </tbody>
</table>
</body>
</html>
`
}

const FORMATTERS = { json: formatAsJson, md: formatAsMarkdown, csv: formatAsCsv, html: formatAsHtml, txt: formatAsText }

export const EXPORT_FORMATS = Object.keys(FORMATTERS)

export function exportTable(rows, columns, format) {
  return FORMATTERS[format](rows, columns)
}

// Guesses a format from the --output file's own extension, for when
// --format isn't given explicitly — .json/.md/.csv/.html are unambiguous,
// anything else (including no extension at all) falls back to plain text.
export function inferExportFormat(outputPath) {
  const ext = path.extname(outputPath).toLowerCase()
  if (ext === '.json') return 'json'
  if (ext === '.md' || ext === '.markdown') return 'md'
  if (ext === '.csv') return 'csv'
  if (ext === '.html' || ext === '.htm') return 'html'
  return 'txt'
}

export function writeExport(outputPath, content) {
  const resolved = path.resolve(outputPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, content)
  return resolved
}
