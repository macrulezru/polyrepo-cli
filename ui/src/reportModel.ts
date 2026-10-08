import { stripAnsi } from './ansi'
import type { LogBuilder, LogItem, LogSection, SectionHealth } from './logModel'

type TableItem = Extract<LogItem, { kind: 'table' }>

export interface Problem {
  where: string
  level: 'fail' | 'warn'
  text: string
}

export interface ReportGroup {
  title: string
  health: SectionHealth
  ok: number
  warn: number
  fail: number
  notes: LogItem[]
  statuses: LogItem[]
  tables: TableItem[]
  output: LogItem[]
}

export type ReportBlock =
  | { kind: 'notes'; items: LogItem[] }
  | { kind: 'group'; group: ReportGroup }
  | { kind: 'table'; table: TableItem; title: string }
  | { kind: 'steps'; cards: ReportGroup[] }

export interface Report {
  blocks: ReportBlock[]
  ok: number
  warn: number
  fail: number
  steps: number
  problems: Problem[]
}

function emptyGroup(title: string): ReportGroup {
  return {
    title,
    health: 'plain',
    ok: 0,
    warn: 0,
    fail: 0,
    notes: [],
    statuses: [],
    tables: [],
    output: [],
  }
}

function place(group: ReportGroup, item: LogItem): void {
  switch (item.kind) {
    case 'status':
      group.statuses.push(item)
      group[item.level] += 1
      break
    case 'line':
      group.notes.push(item)
      break
    case 'table':
      group.tables.push(item)
      break
    case 'command':
    case 'output':
    case 'raw':
      group.output.push(item)
      break
    default:
      break
  }
}

function finish(group: ReportGroup): ReportGroup {
  group.health = group.fail > 0 ? 'fail' : group.warn > 0 ? 'warn' : group.ok > 0 ? 'ok' : 'plain'
  return group
}

function hasContent(group: ReportGroup): boolean {
  return group.statuses.length + group.notes.length + group.tables.length + group.output.length > 0
}

function splitRoot(section: LogSection, blocks: ReportBlock[]): void {
  let current = emptyGroup('')
  const flush = (): void => {
    if (!hasContent(current)) return
    if (current.title === '') {
      blocks.push({ kind: 'notes', items: [...current.statuses, ...current.notes] })
      for (const table of current.tables) blocks.push({ kind: 'table', table, title: '' })
    } else {
      const tables = current.tables
      current.tables = []
      if (hasContent(current)) blocks.push({ kind: 'group', group: finish(current) })
      for (const table of tables)
        blocks.push({ kind: 'table', table, title: hasContent(current) ? '' : current.title })
    }
  }
  for (const item of section.items) {
    if (item.kind === 'heading') {
      flush()
      current = emptyGroup(stripAnsi(item.text))
    } else {
      place(current, item)
    }
  }
  flush()
}

export function buildReport(builder: LogBuilder): Report {
  const blocks: ReportBlock[] = []
  const problems: Problem[] = []
  let ok = 0
  let warn = 0
  let fail = 0
  let steps = 0
  let cards: ReportGroup[] = []

  const flushCards = (): void => {
    if (cards.length > 0) blocks.push({ kind: 'steps', cards })
    cards = []
  }

  for (const section of builder.sections) {
    ok += section.ok
    warn += section.warn
    fail += section.fail
    if (section.title === '') {
      flushCards()
      splitRoot(section, blocks)
    } else {
      steps += 1
      const card = emptyGroup(section.title)
      for (const item of section.items) {
        if (item.kind === 'heading') card.notes.push({ kind: 'line', text: item.text })
        else place(card, item)
      }
      cards.push(finish(card))
    }
  }
  flushCards()

  for (const block of blocks) {
    const groups =
      block.kind === 'group' ? [block.group] : block.kind === 'steps' ? block.cards : []
    for (const group of groups) {
      for (const item of group.statuses) {
        if (item.kind === 'status' && item.level !== 'ok') {
          problems.push({ where: group.title, level: item.level, text: item.text })
        }
      }
    }
    if (block.kind === 'notes') {
      for (const item of block.items) {
        if (item.kind === 'status' && item.level !== 'ok') {
          problems.push({ where: '', level: item.level, text: item.text })
        }
      }
    }
  }

  return { blocks, ok, warn, fail, steps, problems }
}
