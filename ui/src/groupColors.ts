import { store } from './store'

interface Hsl {
  h: number
  s: number
  l: number
}

function toHsl(hex: string): Hsl {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

export function blend(from: string, to: string, t: number): string {
  const a = toHsl(from)
  const b = toHsl(to)
  let delta = b.h - a.h
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  const h = (a.h + delta * t + 360) % 360
  const s = a.s + (b.s - a.s) * t
  const l = a.l + (b.l - a.l) * t
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`
}

export function monorepoNames(): string[] {
  const names = new Set<string>()
  for (const pkg of store.packages) {
    const slash = pkg.dir.indexOf('/')
    if (slash > 0) names.add(pkg.dir.slice(0, slash))
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function colorAt(index: number, count: number): string {
  const { from, to } = store.settings.groupColors
  return blend(from, to, count > 1 ? index / (count - 1) : 0)
}

export function groupColor(name: string, extra: string[] = []): string {
  const names = [...new Set([...monorepoNames(), ...extra])].sort((a, b) => a.localeCompare(b))
  const index = Math.max(0, names.indexOf(name))
  return colorAt(index, names.length)
}
