import { AsyncLocalStorage } from 'node:async_hooks'
import pc from 'picocolors'

const storage = new AsyncLocalStorage()

export function createConsoleReporter() {
  return {
    blank() {
      console.log('')
    },
    line(text = '') {
      console.log(text)
    },
    heading(text) {
      console.log('')
      console.log(pc.bold(pc.cyan(text)))
      console.log('')
    },
    step(index, total, label) {
      console.log('')
      console.log(pc.bold(pc.blue(`[${index}/${total}] ${label}`)))
    },
    ok(text) {
      console.log(pc.green(`  ✓ ${text}`))
    },
    fail(text) {
      console.log(pc.red(`  ✗ ${text}`))
    },
    warn(text) {
      console.log(pc.yellow(`  ! ${text}`))
    },
    command({ cmd, args, mutating = false, dryRun = false }) {
      const prefix = mutating && dryRun ? pc.magenta('  [dry-run] $ ') : pc.dim('  $ ')
      console.log(`${prefix}${cmd} ${args.join(' ')}`)
    },
    output(text) {
      console.log(text)
    },
    table({ rows, columns, groupBy, widths, formatRow }) {
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
    },
    progress(message) {
      return startConsoleSpinner(message)
    },
  }
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL_MS = 80
const CLEAR_LINE = '\r\x1b[K'

function startConsoleSpinner(message) {
  if (!process.stdout.isTTY) {
    console.log(pc.dim(message))
    return { stop() {} }
  }

  let frame = 0
  process.stdout.write(`${pc.yellow(FRAMES[0])} ${message}`)
  const timer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length
    process.stdout.write(`\r${pc.yellow(FRAMES[frame])} ${message}`)
  }, INTERVAL_MS)

  return {
    stop() {
      clearInterval(timer)
      process.stdout.write(`${CLEAR_LINE}${pc.dim(message)}\n`)
    },
  }
}

export function createInquirerPrompter() {
  return {
    async confirm(options) {
      const { confirm } = await import('@inquirer/prompts')
      return confirm(options)
    },
    async checkbox(options) {
      const { checkbox } = await import('@inquirer/prompts')
      return checkbox(options)
    },
    async select(options) {
      const { select } = await import('@inquirer/prompts')
      return select(options)
    },
    async input(options) {
      const { input } = await import('@inquirer/prompts')
      return input(options)
    },
  }
}

export function createRuntime(overrides = {}) {
  return {
    reporter: createConsoleReporter(),
    prompter: createInquirerPrompter(),
    setExitCode(code) {
      process.exitCode = code
    },
    ...overrides,
  }
}

const defaultRuntime = createRuntime()

export function getRuntime() {
  return storage.getStore() ?? defaultRuntime
}

export function runWithRuntime(runtime, task) {
  return storage.run(runtime, task)
}

export function reporter() {
  return getRuntime().reporter
}

export function confirm(options) {
  return getRuntime().prompter.confirm(options)
}

export function checkbox(options) {
  return getRuntime().prompter.checkbox(options)
}

export function select(options) {
  return getRuntime().prompter.select(options)
}

export function input(options) {
  return getRuntime().prompter.input(options)
}

export function blank() {
  getRuntime().reporter.blank()
}

export function line(text = '') {
  getRuntime().reporter.line(text)
}

export function setExitCode(code) {
  getRuntime().setExitCode(code)
}
