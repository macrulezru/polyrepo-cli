import { fork, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runner.js')
const MAX_EVENTS = 50000
const KEEP_RUNS = 100

export function runsDirectory() {
  const home = process.env.POLYREPO_HOME ?? path.join(os.homedir(), '.polyrepo')
  return path.join(home, 'runs')
}

const OEM_ENCODINGS = { 866: 'ibm866', 1251: 'windows-1251', 1252: 'windows-1252' }
let fallbackDecoder

function oemDecoder() {
  if (fallbackDecoder) return fallbackDecoder
  let label = 'windows-1252'
  if (process.platform === 'win32') {
    const result = spawnSync('cmd', ['/c', 'chcp'], { encoding: 'utf8' })
    const page = Number(String(result.stdout ?? '').match(/(\d+)\s*$/m)?.[1])
    label = OEM_ENCODINGS[page] ?? label
  }
  try {
    fallbackDecoder = new TextDecoder(label)
  } catch {
    fallbackDecoder = new TextDecoder('windows-1252')
  }
  return fallbackDecoder
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

function decodeOutput(bytes) {
  try {
    return strictUtf8.decode(bytes)
  } catch {
    return oemDecoder().decode(bytes)
  }
}

function settled(meta) {
  if (meta.status !== 'running' && meta.status !== 'waiting') return meta
  return { ...meta, status: 'failed', error: meta.error ?? 'The run was interrupted when the UI stopped.' }
}

function killTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

export function createRunManager({ directory = runsDirectory(), runner = RUNNER } = {}) {
  const runs = new Map()

  function metaPath(id) {
    return path.join(directory, `${id}.meta.json`)
  }

  function logPath(id) {
    return path.join(directory, `${id}.log.jsonl`)
  }

  function writeMeta(run) {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(
      metaPath(run.id),
      JSON.stringify({
        id: run.id,
        command: run.command,
        title: run.title,
        options: run.options,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        status: run.status,
        exitCode: run.exitCode ?? null,
        error: run.error ?? null,
        events: run.seq,
        stats: run.stats,
      }),
    )
  }

  function prune() {
    try {
      const metas = fs
        .readdirSync(directory)
        .filter((name) => name.endsWith('.meta.json'))
        .map((name) => ({ name, id: name.replace('.meta.json', ''), time: fs.statSync(path.join(directory, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
      for (const old of metas.slice(KEEP_RUNS)) {
        fs.rmSync(path.join(directory, old.name), { force: true })
        fs.rmSync(logPath(old.id), { force: true })
      }
    } catch {
      return
    }
  }

  function publish(run, event) {
    run.seq += 1
    if (event.type === 'ok' || event.type === 'warn' || event.type === 'fail') run.stats[event.type] += 1
    if (event.type === 'step') run.stats.steps += 1
    const entry = { seq: run.seq, event }
    if (run.events.length < MAX_EVENTS) run.events.push(entry)
    try {
      fs.appendFileSync(logPath(run.id), `${JSON.stringify(entry)}\n`)
    } catch {
      run.persist = false
    }
    for (const listener of run.listeners) listener(entry)
  }

  function finish(run, status, extra = {}) {
    if (run.finished) return
    run.finished = true
    run.status = status
    run.finishedAt = new Date().toISOString()
    Object.assign(run, extra)
    publish(run, { type: 'done', status, exitCode: run.exitCode ?? null, error: run.error ?? null })
    writeMeta(run)
    for (const listener of run.listeners) listener(null)
    run.listeners.clear()
    prune()
  }

  function start({ command, title, options = {}, configPath }) {
    const id = `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${randomUUID().slice(0, 6)}`
    const run = {
      id,
      command,
      title: title ?? command,
      options: Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'otp')),
      startedAt: new Date().toISOString(),
      status: 'running',
      events: [],
      seq: 0,
      stats: { ok: 0, warn: 0, fail: 0, steps: 0 },
      listeners: new Set(),
      finished: false,
      child: null,
      pendingQuestions: new Map(),
    }
    runs.set(id, run)
    fs.mkdirSync(directory, { recursive: true })
    writeMeta(run)

    const child = fork(runner, [], {
      env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: '' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    run.child = child

    const buffers = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    const forward = (stream) => (chunk) => {
      let data = Buffer.concat([buffers[stream], chunk])
      let newline = data.indexOf(10)
      while (newline !== -1) {
        const raw = data.subarray(0, newline)
        publish(run, { type: 'raw', stream, text: decodeOutput(raw).replace(/\r$/, '') })
        data = data.subarray(newline + 1)
        newline = data.indexOf(10)
      }
      buffers[stream] = data
    }
    child.stdout.on('data', forward('stdout'))
    child.stderr.on('data', forward('stderr'))

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return
      if (message.type === 'ready') {
        child.send({ type: 'start', command, options, configPath })
      } else if (message.type === 'event') {
        publish(run, message.event)
      } else if (message.type === 'ask') {
        run.status = 'waiting'
        run.pendingQuestions.set(message.id, message.question)
        publish(run, { type: 'prompt', id: message.id, question: message.question })
      } else if (message.type === 'done') {
        run.exitCode = message.exitCode
        run.error = message.error ?? null
        run.doneMessage = true
      }
    })

    child.on('exit', (code) => {
      for (const stream of ['stdout', 'stderr']) {
        if (buffers[stream].length > 0) publish(run, { type: 'raw', stream, text: decodeOutput(buffers[stream]) })
      }
      if (run.cancelled) return finish(run, 'cancelled', { exitCode: null })
      if (run.doneMessage) return finish(run, run.exitCode === 0 ? 'done' : 'failed')
      finish(run, 'failed', { exitCode: code ?? 1, error: 'The run stopped unexpectedly.' })
    })
    child.on('error', (error) => finish(run, 'failed', { exitCode: 1, error: error.message }))
    return summarize(run)
  }

  function summarize(run) {
    return {
      id: run.id,
      command: run.command,
      title: run.title,
      options: run.options,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      status: run.status,
      exitCode: run.exitCode ?? null,
      error: run.error ?? null,
      events: run.seq,
      stats: run.stats,
    }
  }

  function readFromDisk(id) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'))
      let entries = []
      if (fs.existsSync(logPath(id))) {
        entries = fs
          .readFileSync(logPath(id), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((text) => JSON.parse(text))
      }
      return { meta, entries }
    } catch {
      return undefined
    }
  }

  return {
    directory,
    start,
    get(id) {
      const live = runs.get(id)
      if (live) return summarize(live)
      const stored = readFromDisk(id)?.meta
      return stored ? settled(stored) : undefined
    },
    list() {
      const map = new Map()
      try {
        for (const name of fs.readdirSync(directory)) {
          if (!name.endsWith('.meta.json')) continue
          try {
            const meta = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
            map.set(meta.id, settled(meta))
          } catch {
            continue
          }
        }
      } catch {
        return [...runs.values()].map(summarize)
      }
      for (const run of runs.values()) map.set(run.id, summarize(run))
      return [...map.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    },
    log(id) {
      const live = runs.get(id)
      if (live) return live.events
      return readFromDisk(id)?.entries
    },
    subscribe(id, from, listener) {
      const live = runs.get(id)
      if (live) {
        for (const entry of live.events) if (entry.seq > from) listener(entry)
        if (live.finished) {
          listener(null)
          return () => undefined
        }
        live.listeners.add(listener)
        return () => live.listeners.delete(listener)
      }
      const stored = readFromDisk(id)
      if (!stored) return undefined
      for (const entry of stored.entries) if (entry.seq > from) listener(entry)
      listener(null)
      return () => undefined
    },
    answer(id, questionId, answer) {
      const run = runs.get(id)
      if (!run || run.finished || !run.pendingQuestions.has(questionId)) return false
      run.pendingQuestions.delete(questionId)
      run.status = 'running'
      publish(run, { type: 'answered', id: questionId })
      run.child.send({ type: 'answer', id: questionId, answer })
      return true
    },
    cancel(id) {
      const run = runs.get(id)
      if (!run || run.finished) return false
      run.cancelled = true
      killTree(run.child)
      return true
    },
    remove(id) {
      const run = runs.get(id)
      if (run && !run.finished) return false
      runs.delete(id)
      fs.rmSync(metaPath(id), { force: true })
      fs.rmSync(logPath(id), { force: true })
      return true
    },
    stopAll() {
      for (const run of runs.values()) {
        if (!run.finished) {
          run.cancelled = true
          killTree(run.child)
        }
      }
    },
    active() {
      return [...runs.values()].filter((run) => !run.finished).length
    },
  }
}
