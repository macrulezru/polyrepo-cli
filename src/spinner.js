import pc from 'picocolors'

// Classic braille "dots" spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) — same frames @inquirer/core
// uses by default for its own prompts. Visually a 2-column, 3-row dot grid
// with one dot missing at a time, circling around.
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL_MS = 80
const CLEAR_LINE = '\r\x1b[K'

// Covers the "nothing is printed for several seconds" gap while a parallel
// batch (pMap) is in flight and there's no per-item progress to show yet —
// list's full mode, doctor, and the initial repo scan in bump/switch-default
// all used to just sit there silently. Falls back to a single static line
// when stdout isn't a real terminal (piped output, CI logs) — redrawing
// with carriage returns there would just dump a stream of raw \r bytes
// instead of animating.
export function startSpinner(message) {
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
      // Full line clear (not just enough spaces to cover the old text) —
      // the final line's shape doesn't have to match the spinner line's.
      process.stdout.write(`${CLEAR_LINE}${pc.dim(message)}\n`)
    },
  }
}
