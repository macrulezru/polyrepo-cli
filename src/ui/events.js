import { createRuntime } from '../runtime.js'

export function createEventRuntime({ emit, ask }) {
  let progressCounter = 0
  let exitCode = 0

  const reporter = {
    blank() {
      emit({ type: 'blank' })
    },
    line(text = '') {
      emit({ type: 'line', text })
    },
    heading(text) {
      emit({ type: 'heading', text })
    },
    step(index, total, label) {
      emit({ type: 'step', index, total, label })
    },
    ok(text) {
      emit({ type: 'ok', text })
    },
    fail(text) {
      emit({ type: 'fail', text })
    },
    warn(text) {
      emit({ type: 'warn', text })
    },
    command({ cmd, args, mutating = false, dryRun = false }) {
      emit({ type: 'command', cmd, args, mutating, dryRun })
    },
    output(text) {
      emit({ type: 'output', text })
    },
    table({ rows, columns, groupBy }) {
      let lastGroup
      const cells = rows.map((row, index) => {
        const group = groupBy ? groupBy(row) : undefined
        const newGroup = index > 0 && groupBy !== undefined && group !== lastGroup
        lastGroup = group
        return {
          gap: newGroup,
          cells: columns.map((column) => {
            const text = String(column.value(row))
            return { text, styled: column.style ? column.style(row, text) : text }
          }),
        }
      })
      emit({ type: 'table', columns: columns.map((column) => column.label ?? ''), rows: cells })
    },
    progress(message) {
      progressCounter += 1
      const id = progressCounter
      emit({ type: 'progress', id, message, state: 'running' })
      return {
        stop() {
          emit({ type: 'progress', id, message, state: 'done' })
        },
      }
    },
  }

  function describeChoices(choices) {
    return choices.map((choice, index) => ({
      id: index,
      name: choice.name ?? String(choice.value),
      description: choice.description ?? null,
      checked: choice.checked === true,
      disabled: choice.disabled ? String(choice.disabled) : false,
      separator: choice.type === 'separator',
    }))
  }

  const prompter = {
    async confirm({ message, default: initial = true }) {
      const answer = await ask({ kind: 'confirm', message, default: initial })
      return answer === true
    },
    async checkbox({ message, choices }) {
      const answer = await ask({ kind: 'checkbox', message, choices: describeChoices(choices) })
      const picked = new Set(Array.isArray(answer) ? answer : [])
      return choices.filter((choice, index) => picked.has(index) && !choice.disabled).map((choice) => choice.value)
    },
    async select({ message, choices }) {
      const answer = await ask({ kind: 'select', message, choices: describeChoices(choices) })
      const choice = choices[Number(answer)]
      return choice ? choice.value : undefined
    },
    async input({ message, default: initial = '' }) {
      const answer = await ask({ kind: 'input', message, default: initial })
      return typeof answer === 'string' ? answer : initial
    },
  }

  const runtime = createRuntime({
    reporter,
    prompter,
    setExitCode(code) {
      exitCode = code
    },
  })
  runtime.exitCode = () => exitCode
  return runtime
}
