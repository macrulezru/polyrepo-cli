import { runWithRuntime } from '../runtime.js'
import { createEventRuntime } from './events.js'
import { findCommand } from './catalog.js'

let questionCounter = 0
const waiting = new Map()

function send(message) {
  if (process.send) process.send(message)
}

function ask(question) {
  questionCounter += 1
  const id = questionCounter
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    send({ type: 'ask', id, question })
  })
}

async function start({ command, options, configPath }) {
  const entry = findCommand(command)
  if (!entry) {
    send({ type: 'done', exitCode: 2, error: `unknown command "${command}"` })
    return
  }
  const runtime = createEventRuntime({ emit: (event) => send({ type: 'event', event }), ask })
  let error
  try {
    await runWithRuntime(runtime, () => entry.run(options ?? {}, { configPath }))
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
    runtime.setExitCode(1)
  }
  send({ type: 'done', exitCode: runtime.exitCode(), ...(error ? { error } : {}) })
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return
  if (message.type === 'start') {
    void start(message).then(() => setTimeout(() => process.exit(0), 50))
  } else if (message.type === 'answer') {
    const resolve = waiting.get(message.id)
    if (resolve) {
      waiting.delete(message.id)
      resolve(message.answer)
    }
  }
})

send({ type: 'ready' })
