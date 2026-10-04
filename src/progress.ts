import type { Exercise, SetEntry, Workout, WorkoutType } from './db'
import { fmtNum } from './format'
import { e1rm } from './stats'

/** The lifts the Progress list always shows, in order. Matched by name (case/punctuation-insensitive). */
export const BIG_FIVE: { label: string; names: string[] }[] = [
  { label: 'Bench', names: ['benchpress', 'bench', 'barbellbenchpress', 'flatbenchpress'] },
  { label: 'Squat', names: ['backsquat', 'squat', 'barbellsquat', 'barbellbacksquat'] },
  { label: 'Deadlift', names: ['deadlift', 'conventionaldeadlift', 'barbelldeadlift'] },
  { label: 'Barbell Row', names: ['barbellrow', 'bentoverrow', 'bentoverbarbellrow'] },
  { label: 'Overhead Press', names: ['overheadpress', 'ohp', 'militarypress', 'standingoverheadpress'] },
]

export const normName = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '')

export type RangeId = '1M' | '2M' | '6M' | '1Y' | 'ALL'
export const RANGES: RangeId[] = ['1M', '2M', '6M', '1Y', 'ALL']
const RANGE_MONTHS: Record<Exclude<RangeId, 'ALL'>, number> = { '1M': 1, '2M': 2, '6M': 6, '1Y': 12 }

/** Start of the range, ms (0 for ALL). */
export function rangeStart(range: RangeId, now: number) {
  if (range === 'ALL') return 0
  const d = new Date(now)
  d.setMonth(d.getMonth() - RANGE_MONTHS[range])
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface Point {
  t: number
  value: number
  /** The set that gave the session its value. */
  best: SetEntry
}

/** One point per workout: the best estimated 1-rep max of that session's sets. Oldest first. */
export function sessionPoints(sets: SetEntry[], workouts: Map<number, Workout>): Point[] {
  const byWorkout = new Map<number, Point>()
  for (const s of sets) {
    const value = e1rm(s.weight, s.reps)
    if (value <= 0) continue
    const cur = byWorkout.get(s.workoutId)
    if (!cur || value > cur.value) {
      const t = workouts.get(s.workoutId)?.startedAt ?? s.completedAt
      byWorkout.set(s.workoutId, { t, value, best: s })
    }
  }
  return [...byWorkout.values()].sort((a, b) => a.t - b.t)
}

/** Best set as a short string: "130×6". */
export function fmtBestSet(s: SetEntry) {
  return `${fmtNum(s.weight ?? 0)}×${s.reps ?? 0}`
}

export interface Change {
  /** Absolute change in the metric (lb). */
  diff: number
  /** Percent change. */
  pct: number
  up: boolean
}

export function change(points: Point[]): Change | null {
  if (points.length < 2) return null
  const first = points[0].value
  const last = points[points.length - 1].value
  const diff = last - first
  return { diff, pct: first > 0 ? (diff / first) * 100 : 0, up: diff >= 0 }
}

/** "+15 lb", "−5 lb" (true minus sign). */
export function fmtDiff(c: Change) {
  return `${c.diff >= 0 ? '+' : '−'}${Math.round(Math.abs(c.diff))} lb`
}

export function fmtPct(p: number) {
  const r = Math.round(p * 10) / 10
  return `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}%`
}

/** Span between the first and last point: "8 wks", "5 days", "3 mo". */
export function fmtSpan(points: Point[]) {
  if (points.length < 2) return ''
  const days = Math.round((points[points.length - 1].t - points[0].t) / 86400000)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 120) return `${Math.round(days / 7)} wks`
  return `${Math.round(days / 30.4)} mo`
}

// ---------- weekly volume ----------

/** Monday 00:00 local of the week containing `ts`. */
export function weekStart(ts: number) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

/** Volume (weight × reps, weighted lifts only) for the last `n` weeks, oldest first; the last entry is this week. */
export function weeklyVolume(
  sets: SetEntry[],
  kindOf: (exerciseId: number) => Exercise['kind'] | undefined,
  now: number,
  n = 8,
) {
  const thisWeek = weekStart(now)
  const starts: number[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(thisWeek)
    d.setDate(d.getDate() - 7 * i)
    starts.push(d.getTime())
  }
  const totals = starts.map(() => 0)
  for (const s of sets) {
    if (kindOf(s.exerciseId) !== 'weight' || !s.weight || !s.reps) continue
    const ws = weekStart(s.completedAt)
    const i = starts.indexOf(ws)
    if (i >= 0) totals[i] += s.weight * s.reps
  }
  return starts.map((start, i) => ({ start, volume: totals[i] }))
}

/** Volume (weighted lifts) of sets completed in [from, to). */
export function volumeBetween(
  sets: SetEntry[],
  kindOf: (exerciseId: number) => Exercise['kind'] | undefined,
  from: number,
  to: number,
) {
  let v = 0
  for (const s of sets) {
    if (s.completedAt < from || s.completedAt >= to || kindOf(s.exerciseId) !== 'weight') continue
    v += (s.weight ?? 0) * (s.reps ?? 0)
  }
  return v
}

// ---------- weekly strength change (Start screen) ----------

/**
 * Average % change in estimated 1-rep max per workout type.
 * Anchor = the most recent Mon–Sun week with a workout of that type. Each weighted
 * exercise trained in the anchor week is compared with its best e1RM in its most recent
 * earlier week (same type). Exercises without a real e1RM in both weeks are left out,
 * never counted as 0. Needs at least `minExercises` to show; otherwise null.
 */
export function weeklyStrengthChange(
  sets: SetEntry[],
  workouts: Workout[],
  kindOf: (exerciseId: number) => Exercise['kind'] | undefined,
  minExercises = 2,
): Record<WorkoutType, number | null> {
  const result: Record<WorkoutType, number | null> = { push: null, pull: null, legs: null, other: null }
  const typeOf = new Map<number, WorkoutType>()
  const weekOf = new Map<number, number>()
  for (const w of workouts) {
    if (w.id == null) continue
    typeOf.set(w.id, w.type)
    weekOf.set(w.id, weekStart(w.startedAt))
  }
  // type -> exercise -> week -> best e1RM
  const best = new Map<WorkoutType, Map<number, Map<number, number>>>()
  const typeWeeks = new Map<WorkoutType, Set<number>>()
  for (const w of workouts) {
    if (w.id == null) continue
    if (!typeWeeks.has(w.type)) typeWeeks.set(w.type, new Set())
    typeWeeks.get(w.type)!.add(weekOf.get(w.id)!)
  }
  for (const s of sets) {
    const type = typeOf.get(s.workoutId)
    const week = weekOf.get(s.workoutId)
    if (type == null || week == null || kindOf(s.exerciseId) !== 'weight') continue
    const v = e1rm(s.weight, s.reps)
    if (v <= 0) continue
    if (!best.has(type)) best.set(type, new Map())
    const byEx = best.get(type)!
    if (!byEx.has(s.exerciseId)) byEx.set(s.exerciseId, new Map())
    const byWeek = byEx.get(s.exerciseId)!
    if (v > (byWeek.get(week) ?? 0)) byWeek.set(week, v)
  }
  for (const [type, weeks] of typeWeeks) {
    const anchor = Math.max(...weeks)
    const changes: number[] = []
    for (const byWeek of best.get(type)?.values() ?? []) {
      const now = byWeek.get(anchor)
      if (now == null) continue
      let prevWeek = -Infinity
      for (const wk of byWeek.keys()) if (wk < anchor && wk > prevWeek) prevWeek = wk
      if (prevWeek === -Infinity) continue
      const before = byWeek.get(prevWeek)!
      changes.push(((now - before) / before) * 100)
    }
    if (changes.length >= minExercises) result[type] = changes.reduce((a, b) => a + b, 0) / changes.length
  }
  return result
}

// ---------- drawing ----------

/**
 * Smooth path through points (monotone cubic, so the curve never overshoots
 * above a PR or below a low). Coordinates already in SVG space.
 */
export function smoothPath(pts: { x: number; y: number }[]) {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x)
    slope.push(dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i])
  }
  const tan: number[] = [slope[0]]
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) tan.push(0)
    else {
      const w1 = 2 * dx[i] + dx[i - 1]
      const w2 = dx[i] + 2 * dx[i - 1]
      tan.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]))
    }
  }
  tan.push(slope[n - 2])
  const f = (v: number) => Math.round(v * 10) / 10
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${f(pts[i].x + h)},${f(pts[i].y + tan[i] * h)} ${f(pts[i + 1].x - h)},${f(pts[i + 1].y - tan[i + 1] * h)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`
  }
  return d
}

/** Scale points into a w×h box (time on x, value on y, higher value = higher on screen). */
export function scalePoints(points: Point[], w: number, h: number, padX: number, padY: number) {
  if (points.length === 0) return []
  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  let lo = Math.min(...points.map((p) => p.value))
  let hi = Math.max(...points.map((p) => p.value))
  if (hi - lo < 1) {
    lo -= 5
    hi += 5
  }
  const span = hi - lo
  lo -= span * 0.12
  hi += span * 0.12
  return points.map((p) => ({
    x: t1 === t0 ? w / 2 : padX + ((p.t - t0) / (t1 - t0)) * (w - 2 * padX),
    y: padY + (1 - (p.value - lo) / (hi - lo)) * (h - 2 * padY),
  }))
}
