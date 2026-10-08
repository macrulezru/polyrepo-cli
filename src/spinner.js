import { getRuntime } from './runtime.js'

export function startSpinner(message) {
  return getRuntime().reporter.progress(message)
}
