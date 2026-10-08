import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import pc from 'picocolors'
import { createConsoleReporter, getRuntime, runWithRuntime, createRuntime } from '../src/runtime.js'
import { createEventRuntime } from '../src/ui/events.js'
import { heading, ok, fail, warn, printTable, stepHeading } from '../src/ui.js'
import { listCommand } from '../src/commands/list.js'
import { selectPackages } from '../src/selectPackages.js'
import { filterByNames } from '../src/filterByNames.js'

function capture(task) {
  const lines = []
  const original = console.log
  console.log = (...args) => lines.push(args.join(' '))
  try {
    return Promise.resolve(task()).then(() => lines)
  } finally {
    console.log = original
  }
}

function recording() {
  const events = []
  const runtime = createEventRuntime({
    emit: (event) => events.push(event),
    ask: async () => undefined,
  })
  return { events, runtime }
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

function makeRepo(root, name, version) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }, null, 2))
  git(dir, 'init', '-q', '-b', 'master')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

test('the console reporter prints the same lines the CLI always printed', async () => {
  const lines = await capture(async () => {
    const reporter = createConsoleReporter()
    reporter.heading('Packages')
    reporter.step(1, 2, 'os-detect')
    reporter.ok('done')
    reporter.fail('broke')
    reporter.warn('careful')
    reporter.command({ cmd: 'git', args: ['push'], mutating: true, dryRun: true })
    reporter.command({ cmd: 'git', args: ['fetch'] })
    reporter.output('    text')
    reporter.blank()
    reporter.line('plain')
  })
  assert.deepEqual(lines, [
    '',
    pc.bold(pc.cyan('Packages')),
    '',
    '',
    pc.bold(pc.blue('[1/2] os-detect')),
    pc.green('  ✓ done'),
    pc.red('  ✗ broke'),
    pc.yellow('  ! careful'),
    `${pc.magenta('  [dry-run] $ ')}git push`,
    `${pc.dim('  $ ')}git fetch`,
    '    text',
    '',
    'plain',
  ])
})

test('the ui helpers go through whichever runtime is current', () => {
  const { events, runtime } = recording()
  runWithRuntime(runtime, () => {
    heading('Bump')
    stepHeading(2, 3, 'pkg')
    ok('fine')
    fail('bad')
    warn('hmm')
  })
  assert.deepEqual(events, [
    { type: 'heading', text: 'Bump' },
    { type: 'step', index: 2, total: 3, label: 'pkg' },
    { type: 'ok', text: 'fine' },
    { type: 'fail', text: 'bad' },
    { type: 'warn', text: 'hmm' },
  ])
})

test('two runs in flight at once keep their own runtime', async () => {
  const a = recording()
  const b = recording()
  const work = (name) => async () => {
    heading(`${name} start`)
    await new Promise((resolve) => setTimeout(resolve, name === 'a' ? 15 : 5))
    heading(`${name} end`)
    assert.equal(getRuntime().exitCode(), 0)
  }
  await Promise.all([runWithRuntime(a.runtime, work('a')), runWithRuntime(b.runtime, work('b'))])
  assert.deepEqual(
    a.events.map((event) => event.text),
    ['a start', 'a end'],
  )
  assert.deepEqual(
    b.events.map((event) => event.text),
    ['b start', 'b end'],
  )
})

test('a command sets its exit code on the runtime it runs in, not on the process', async () => {
  const { runtime } = recording()
  const before = process.exitCode
  const { setExitCode } = await import('../src/runtime.js')
  runWithRuntime(runtime, () => setExitCode(1))
  assert.equal(runtime.exitCode(), 1)
  assert.equal(process.exitCode, before)
})

test('printTable under the event runtime reports columns, cells, styled cells and group gaps', () => {
  const { events, runtime } = recording()
  const rows = [
    { name: 'a', pkg: 'x', n: 1 },
    { name: 'b', pkg: 'x', n: 2 },
    { name: 'c', pkg: 'y', n: 3 },
  ]
  runWithRuntime(runtime, () =>
    printTable(
      rows,
      [
        { label: 'Name', value: (r) => r.name },
        { label: 'N', value: (r) => r.n, style: (r, text) => `<${text}>` },
      ],
      { groupBy: (r) => r.pkg },
    ),
  )
  assert.equal(events.length, 1)
  const table = events[0]
  assert.equal(table.type, 'table')
  assert.deepEqual(table.columns, ['Name', 'N'])
  assert.deepEqual(
    table.rows.map((row) => row.gap),
    [false, false, true],
  )
  assert.deepEqual(table.rows[2].cells, [
    { text: 'c', styled: 'c' },
    { text: '3', styled: '<3>' },
  ])
})

test('progress reports a start and a stop with the same id', () => {
  const { events, runtime } = recording()
  runWithRuntime(runtime, () => {
    const spinner = getRuntime().reporter.progress('Checking...')
    spinner.stop()
  })
  assert.deepEqual(events, [
    { type: 'progress', id: 1, message: 'Checking...', state: 'running' },
    { type: 'progress', id: 1, message: 'Checking...', state: 'done' },
  ])
})

test('prompts become questions, and answers map back to the real values', async () => {
  const questions = []
  const answers = [true, [0, 2], 1, 'typed']
  const runtime = createEventRuntime({
    emit: () => undefined,
    ask: async (question) => {
      questions.push(question)
      return answers.shift()
    },
  })
  const confirmed = await runtime.prompter.confirm({ message: 'Go?', default: false })
  const picked = await runtime.prompter.checkbox({
    message: 'Pick',
    choices: [
      { name: 'one', value: { id: 1 } },
      { name: 'two', value: { id: 2 }, disabled: 'no tag' },
      { name: 'three', value: { id: 3 }, checked: true },
    ],
  })
  const selected = await runtime.prompter.select({
    message: 'Which',
    choices: [{ name: 'a', value: 'A' }, { name: 'b', value: 'B' }],
  })
  const typed = await runtime.prompter.input({ message: 'Name', default: 'x' })
  assert.equal(confirmed, true)
  assert.deepEqual(picked, [{ id: 1 }, { id: 3 }])
  assert.equal(selected, 'B')
  assert.equal(typed, 'typed')
  assert.equal(questions[0].kind, 'confirm')
  assert.equal(questions[0].default, false)
  assert.deepEqual(
    questions[1].choices.map((choice) => [choice.id, choice.name, choice.checked, choice.disabled]),
    [
      [0, 'one', false, false],
      [1, 'two', false, 'no tag'],
      [2, 'three', true, false],
    ],
  )
})

test('selectPackages with a --packages list never prompts and warns about unknown names', async () => {
  const { events, runtime } = recording()
  const items = [{ dir: 'a' }, { dir: 'b' }]
  const chosen = await runWithRuntime(runtime, () =>
    selectPackages({ items, packages: ['b', 'nope'], message: 'Pick', buildChoice: () => () => ({}) }),
  )
  assert.deepEqual(chosen, [{ dir: 'b' }])
  assert.equal(events.length, 1)
  assert.match(events[0].text, /Unknown package, ignoring: nope/)
  assert.equal(filterByNames(items, ['a']).length, 1)
})

test('selectPackages asks the current prompter when no list is given', async () => {
  let asked
  const runtime = createRuntime({
    prompter: {
      async checkbox(options) {
        asked = options
        return [options.choices[0].value]
      },
    },
  })
  const items = [{ dir: 'a' }, { dir: 'b' }]
  const chosen = await runWithRuntime(runtime, () =>
    selectPackages({
      items,
      message: 'Pick some',
      buildChoice: () => (item) => ({ name: item.dir, value: item }),
    }),
  )
  assert.equal(asked.message, 'Pick some')
  assert.deepEqual(chosen, [{ dir: 'a' }])
})

test('list --quick reports its heading, progress and a table of the repos it found', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polyrepo-list-test-'))
  makeRepo(root, 'alpha', '1.2.3')
  const beta = makeRepo(root, 'beta', '0.0.1')
  fs.writeFileSync(path.join(beta, 'dirty.txt'), 'x')
  const configPath = path.join(root, 'polyrepo.config.json')
  fs.writeFileSync(configPath, JSON.stringify({ roots: [root], packages: [] }))

  const { events, runtime } = recording()
  await runWithRuntime(runtime, () => listCommand({ configPath, quick: true }))

  assert.equal(events[0].type, 'heading')
  assert.equal(events[0].text, 'Packages (2)')
  const progress = events.filter((event) => event.type === 'progress')
  assert.deepEqual(
    progress.map((event) => event.state),
    ['running', 'done'],
  )
  const table = events.find((event) => event.type === 'table')
  assert.deepEqual(table.columns, ['Package', 'Local', 'Branch', 'Git'])
  const rows = Object.fromEntries(table.rows.map((row) => [row.cells[0].text, row.cells.map((cell) => cell.text)]))
  assert.deepEqual(rows.alpha, ['alpha', '1.2.3', 'master', 'clean'])
  assert.deepEqual(rows.beta, ['beta', '0.0.1', 'master', 'dirty'])
  assert.equal(runtime.exitCode(), 0)
})

test('list reports a missing config as a warning line instead of crashing', async () => {
  const { events, runtime } = recording()
  await runWithRuntime(runtime, () => listCommand({ configPath: path.join(os.tmpdir(), 'polyrepo-no-such-config.json') }))
  const lines = events.filter((event) => event.type === 'line').map((event) => event.text)
  assert.ok(lines.some((text) => text.includes('Config file not found')))
  assert.ok(lines.some((text) => text.includes('No repos found.')))
})
