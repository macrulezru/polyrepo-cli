export interface AuditAdvisory {
  title: string
  url: string
}

export interface AuditEntry {
  name: string
  range: string
  severity: string
  advisories: AuditAdvisory[]
  willInstall: string
  breaking: boolean
}

export interface AuditGroup {
  target: string
  breaking: boolean
  entries: AuditEntry[]
}

export interface AuditReport {
  total: number
  counts: { severity: string; count: number }[]
  changed: string
  entries: AuditEntry[]
  groups: AuditGroup[]
}

const SUMMARY = /^(\d+)\s+vulnerabilit(?:y|ies)\s*\(([^)]*)\)/i
const CHANGED = /^(changed|added|removed|updated)\s.*$/i
const HEADER = /^(@?[^\s]+)\s{2,}(\S.*)$/
const ADVISORY = /^(.*?)\s+-\s+(https?:\/\/\S+)$/
const WILL_INSTALL = /^Will install\s+(\S+?),?\s*(?:which is a breaking change)?\s*$/i
const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info']

function rank(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity)
  return index < 0 ? 99 : index
}

function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => /^\s*/.exec(line)?.[0].length ?? 0)
  const base = indents.length > 0 ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(base).replace(/\s+$/, ''))
}

export function parseAudit(text: string): AuditReport | undefined {
  const lines = dedent(text.split('\n'))
  let total = 0
  let counts: AuditReport['counts'] = []
  let changed = ''
  const entries: AuditEntry[] = []
  let current: AuditEntry | undefined
  let inReport = false

  for (const line of lines) {
    const summary = SUMMARY.exec(line.trim())
    if (summary && !line.startsWith(' ')) {
      total = Number(summary[1])
      counts = (summary[2] ?? '')
        .split(',')
        .map((part) => /(\d+)\s+(\w+)/.exec(part.trim()))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => ({ severity: (match[2] ?? '').toLowerCase(), count: Number(match[1]) }))
        .sort((a, b) => rank(a.severity) - rank(b.severity))
      continue
    }
    if (!inReport && /^#\s*npm audit report/i.test(line.trim())) {
      inReport = true
      continue
    }
    if (!changed && CHANGED.test(line.trim()) && /packages?/.test(line)) changed = line.trim()
    if (!inReport || line.trim() === '') continue
    if (line.startsWith(' ')) continue

    const severity = /^Severity:\s*(\w+)/i.exec(line)
    if (severity && current) {
      current.severity = (severity[1] ?? '').toLowerCase()
      continue
    }
    const install = WILL_INSTALL.exec(line)
    if (install && current) {
      current.willInstall = install[1] ?? ''
      current.breaking = /breaking change/i.test(line)
      continue
    }
    if (/^fix available/i.test(line) || /^node_modules\//.test(line) || /^To address/i.test(line))
      continue
    if (/^npm audit/i.test(line)) continue
    const advisory = ADVISORY.exec(line)
    if (advisory && current) {
      current.advisories.push({ title: advisory[1] ?? '', url: advisory[2] ?? '' })
      continue
    }
    const header = HEADER.exec(line)
    if (header) {
      current = {
        name: header[1] ?? '',
        range: header[2] ?? '',
        severity: '',
        advisories: [],
        willInstall: '',
        breaking: false,
      }
      entries.push(current)
    }
  }

  if (total === 0 && entries.length === 0) return undefined

  const remaining = counts.flatMap(({ severity, count }) => Array<string>(count).fill(severity))
  for (const entry of entries) {
    const at = remaining.indexOf(entry.severity)
    if (entry.severity && at >= 0) remaining.splice(at, 1)
  }
  const unknown = entries.filter((entry) => entry.severity === '')
  if (unknown.length > 0 && unknown.length === remaining.length) {
    unknown.forEach((entry, i) => {
      entry.severity = remaining[i] ?? ''
    })
  }

  const byTarget = new Map<string, AuditGroup>()
  for (const entry of entries) {
    const key = entry.willInstall || ''
    let group = byTarget.get(key)
    if (!group) {
      group = { target: key, breaking: entry.breaking, entries: [] }
      byTarget.set(key, group)
    }
    group.entries.push(entry)
  }
  const groups = [...byTarget.values()]
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((a, b) => rank(a.severity) - rank(b.severity)),
    }))
    .sort((a, b) => {
      if (a.target === '' || b.target === '') return a.target === '' ? 1 : -1
      return rank(a.entries[0]?.severity ?? '') - rank(b.entries[0]?.severity ?? '')
    })

  return { total: total || entries.length, counts, changed, entries, groups }
}
