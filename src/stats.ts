import type { Exercise, SetEntry } from './db'
import { fmtDuration, fmtNum } from './format'

/** Estimated 1-rep max (Epley). A single is taken as-is. */
export function e1rm(weight: number | undefined, reps: number | undefined) {
  if (!weight || !reps) return 0
  return reps === 1 ? weight : weight * (1 + reps / 30)
}

/** Best estimated 1-rep max across sets (0 if none qualify). */
export function bestE1rm(sets: SetEntry[]) {
  return sets.reduce((m, s) => Math.max(m, e1rm(s.weight, s.reps)), 0)
}

type KindOf = (exerciseId: number) => Exercise['kind'] | undefined

/** One set's volume (weight × reps). Only weighted lifts count; bodyweight, timed and cardio add 0. */
export function setVolume(s: SetEntry, kindOf: KindOf) {
  return kindOf(s.exerciseId) === 'weight' ? (s.weight ?? 0) * (s.reps ?? 0) : 0
}

/** Total weight moved (weight × reps) for weighted sets. */
export function volume(sets: SetEntry[], kindOf: KindOf) {
  return sets.reduce((sum, s) => sum + setVolume(s, kindOf), 0)
}

/**
 * Short value for a set tile: "190×8", "+25×8", "12", "0:45".
 * Assistable exercises: "A50×8" (assisted), "BW×8" (unassisted), "+25×8" (added).
 */
export function fmtTile(kind: Exercise['kind'], s: SetEntry, assistable?: boolean) {
  switch (kind) {
    case 'weight':
      return `${fmtNum(s.weight ?? 0)}×${s.reps ?? 0}`
    case 'bodyweight':
      if (s.assist) return `A${fmtNum(s.assist)}×${s.reps ?? 0}`
      if (s.weight) return `+${fmtNum(s.weight)}×${s.reps ?? 0}`
      return assistable ? `BW×${s.reps ?? 0}` : `${s.reps ?? 0}`
    case 'timed':
    case 'cardio':
      return fmtDuration(s.durationSec)
  }
}

/** Compact summary of a session: "65×10 ×3" when every set matches, else "185×8 · 185×8 · 185×7". */
export function fmtSession(kind: Exercise['kind'], sets: SetEntry[], assistable?: boolean) {
  const tiles = sets.map((s) => fmtTile(kind, s, assistable))
  if (tiles.length > 1 && tiles.every((t) => t === tiles[0])) return `${tiles[0]} ×${tiles.length}`
  return tiles.join(' · ')
}

export interface Delta {
  text: string
  up: boolean
}

/** Load relative to bodyweight: added weight counts +, assistance counts −. */
const effectiveLoad = (s: SetEntry) => (s.weight ?? 0) - (s.assist ?? 0)

/** Change vs the same set last session. Load first (less assist = up), then reps (or time for holds). */
export function setDelta(kind: Exercise['kind'], now: SetEntry, before: SetEntry | undefined): Delta | null {
  if (!before) return null
  if (kind === 'weight' || kind === 'bodyweight') {
    const dw = effectiveLoad(now) - effectiveLoad(before)
    if (dw !== 0) return { text: `${dw > 0 ? '▲' : '▼'}${fmtNum(Math.abs(dw))} lb`, up: dw > 0 }
    const dr = (now.reps ?? 0) - (before.reps ?? 0)
    if (dr !== 0) return { text: `${dr > 0 ? '▲' : '▼'}${Math.abs(dr)} rep${Math.abs(dr) === 1 ? '' : 's'}`, up: dr > 0 }
    return null
  }
  if (kind === 'timed') {
    const dt = (now.durationSec ?? 0) - (before.durationSec ?? 0)
    if (dt !== 0) return { text: `${dt > 0 ? '▲' : '▼'}${Math.abs(dt)}s`, up: dt > 0 }
  }
  return null
}

export function fmtLbs(n: number) {
  return Math.round(n).toLocaleString('en-US')
}
