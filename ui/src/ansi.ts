export interface AnsiSegment {
  text: string
  cls: string
}

const COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const ESCAPE = /\x1b\[([0-9;]*)m/g

export function stripAnsi(text: string): string {
  return text.replace(ESCAPE, '')
}

export function ansiSegments(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let bold = false
  let dim = false
  let italic = false
  let underline = false
  let fg = ''
  let last = 0

  const classes = (): string => {
    const found: string[] = []
    if (bold) found.push('a-bold')
    if (dim) found.push('a-dim')
    if (italic) found.push('a-italic')
    if (underline) found.push('a-underline')
    if (fg) found.push(`a-${fg}`)
    return found.join(' ')
  }

  const push = (chunk: string): void => {
    if (chunk !== '') segments.push({ text: chunk, cls: classes() })
  }

  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(last, match.index))
    last = (match.index ?? 0) + match[0].length
    const codes = (match[1] ?? '') === '' ? [0] : (match[1] ?? '').split(';').map(Number)
    for (const code of codes) {
      if (code === 0) {
        bold = dim = italic = underline = false
        fg = ''
      } else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 3) italic = true
      else if (code === 4) underline = true
      else if (code === 22) bold = dim = false
      else if (code === 23) italic = false
      else if (code === 24) underline = false
      else if (code >= 30 && code <= 37) fg = COLORS[code - 30] ?? ''
      else if (code >= 90 && code <= 97) fg = `bright-${COLORS[code - 90] ?? ''}`
      else if (code === 39) fg = ''
    }
  }
  push(text.slice(last))
  return segments
}
