import type { Exercise, SetEntry, Workout } from './db'
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

/**
 * How a lift is measured on the Progress tab.
 * - e1rm: weighted lifts, best estimated 1-rep max of the session.
 * - load: assistable bodyweight lifts, best effective load of the session
 *   (added weight +, assist −, plain bodyweight 0). Higher is better either way.
 */
export type Metric = 'e1rm' | 'load'

export interface Point {
  t: number
  value: number
  /** The set that gave the session its value. */
  best: SetEntry
}

/** One point per workout: the best value of that session's sets. Oldest first. */
export function sessionPoints(sets: SetEntry[], metric: Metric, workouts: Map<number, Workout>): Point[] {
  const byWorkout = new Map<number, Point>()
  for (const s of sets) {
    if (!s.reps) continue
    const value = metric === 'e1rm' ? e1rm(s.weight, s.reps) : (s.weight ?? 0) - (s.assist ?? 0)
    if (metric === 'e1rm' && value <= 0) continue
    const cur = byWorkout.get(s.workoutId)
    // Ties (same load) go to the set with more reps.
    if (!cur || value > cur.value || (value === cur.value && (s.reps ?? 0) > (cur.best.reps ?? 0))) {
      const t = workouts.get(s.workoutId)?.startedAt ?? s.completedAt
      byWorkout.set(s.workoutId, { t, value, best: s })
    }
  }
  return [...byWorkout.values()].sort((a, b) => a.t - b.t)
}

/** Load as the app writes it: "A85" assisted, "BW" bodyweight, "+10" added. */
export function fmtLoad(v: number) {
  const r = Math.round(v * 10) / 10
  if (r < 0) return `A${fmtNum(-r)}`
  if (r === 0) return 'BW'
  return `+${fmtNum(r)}`
}

/** Best set as a short string: "130×6", "A85×8", "BW×10", "+10×6". */
export function fmtBestSet(metric: Metric, s: SetEntry) {
  if (metric === 'e1rm') return `${fmtNum(s.weight ?? 0)}×${s.reps ?? 0}`
  return `${fmtLoad((s.weight ?? 0) - (s.assist ?? 0))}×${s.reps ?? 0}`
}

export interface Change {
  /** Absolute change in the metric (lb). */
  diff: number
  /** Percent change, e1RM only. */
  pct?: number
  up: boolean
}

export function change(points: Point[], metric: Metric): Change | null {
  if (points.length < 2) return null
  const first = points[0].value
  const last = points[points.length - 1].value
  const diff = last - first
  return { diff, pct: metric === 'e1rm' && first > 0 ? (diff / first) * 100 : undefined, up: diff >= 0 }
}

/** "+15 lb", "−5 lb" (true minus sign). For assisted lifts: "35 lb less assist". */
export function fmtDiff(c: Change, metric: Metric, first: number, last: number) {
  const n = metric === 'e1rm' ? String(Math.round(Math.abs(c.diff))) : fmtNum(Math.round(Math.abs(c.diff) * 10) / 10)
  if (metric === 'load' && first < 0 && last <= 0 && c.diff !== 0) {
    return `${n} lb ${c.diff > 0 ? 'less' : 'more'} assist`
  }
  return `${c.diff >= 0 ? '+' : '−'}${n} lb`
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
