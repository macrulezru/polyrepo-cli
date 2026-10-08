import type { RunEvent, TableCell } from './api'
import { stripAnsi } from './ansi'

export type LogItem =
  | { kind: 'blank' }
  | { kind: 'line'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'status'; level: 'ok' | 'fail' | 'warn'; text: string }
  | { kind: 'command'; cmd: string; args: string[]; mutating: boolean; dryRun: boolean }
  | { kind: 'output'; text: string }
  | { kind: 'raw'; stream: 'stdout' | 'stderr'; text: string }
  | { kind: 'table'; columns: string[]; rows: { gap: boolean; cells: TableCell[] }[] }
  | { kind: 'progress'; id: number; message: string; state: 'running' | 'done' }

export interface LogSection {
  id: number
  title: string
  index: number
  total: number
  items: LogItem[]
  ok: number
  fail: number
  warn: number
}

export type SectionHealth = 'fail' | 'warn' | 'ok' | 'plain'

export function healthOf(section: LogSection): SectionHealth {
  if (section.fail > 0) return 'fail'
  if (section.warn > 0) return 'warn'
  if (section.ok > 0) return 'ok'
  return 'plain'
}

export function itemText(item: LogItem): string {
  switch (item.kind) {
    case 'blank':
      return ''
    case 'line':
    case 'heading':
    case 'output':
    case 'raw':
      return stripAnsi(item.text)
    case 'status':
      return `${item.level === 'ok' ? '✓' : item.level === 'fail' ? '✗' : '!'} ${stripAnsi(item.text)}`
    case 'command':
      return `$ ${[item.cmd, ...item.args].join(' ')}`
    case 'progress':
      return item.message
    case 'table':
      return [
        item.columns.join('\t'),
        ...item.rows.map((row) => row.cells.map((cell) => stripAnsi(cell.text)).join('\t')),
      ].join('\n')
  }
}

export class LogBuilder {
  sections: LogSection[] = []
  plain: string[] = []
  private nextId = 1
  private progress = new Map<number, Extract<LogItem, { kind: 'progress' }>>()

  constructor() {
    this.open('', 0, 0)
  }

  private open(title: string, index: number, total: number): void {
    this.sections.push({
      id: this.nextId++,
      title,
      index,
      total,
      items: [],
      ok: 0,
      fail: 0,
      warn: 0,
    })
  }

  private get last(): LogSection {
    return this.sections[this.sections.length - 1] as LogSection
  }

  private add(item: LogItem): void {
    this.last.items.push(item)
    this.plain.push(itemText(item))
  }

  push(event: RunEvent): void {
    switch (event.type) {
      case 'blank':
        this.add({ kind: 'blank' })
        break
      case 'line':
        this.add({ kind: 'line', text: event.text })
        break
      case 'heading':
        this.add({ kind: 'heading', text: event.text })
        break
      case 'step':
        this.open(event.label, event.index, event.total)
        this.plain.push(`[${event.index}/${event.total}] ${event.label}`)
        break
      case 'ok':
      case 'fail':
      case 'warn':
        this.last[event.type] += 1
        this.add({ kind: 'status', level: event.type, text: event.text })
        break
      case 'command':
        this.add({
          kind: 'command',
          cmd: event.cmd,
          args: event.args,
          mutating: event.mutating,
          dryRun: event.dryRun,
        })
        break
      case 'output':
        this.add({ kind: 'output', text: event.text })
        break
      case 'raw':
        this.add({ kind: 'raw', stream: event.stream, text: event.text })
        break
      case 'table':
        this.add({ kind: 'table', columns: event.columns, rows: event.rows })
        break
      case 'progress': {
        const known = this.progress.get(event.id)
        if (known) {
          known.state = event.state
          known.message = event.message
        } else {
          const item: Extract<LogItem, { kind: 'progress' }> = {
            kind: 'progress',
            id: event.id,
            message: event.message,
            state: event.state,
          }
          this.progress.set(event.id, item)
          this.add(item)
        }
        break
      }
      default:
        break
    }
  }

  text(): string {
    return this.plain.join('\n')
  }
}
