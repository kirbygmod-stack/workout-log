import type { WeightEntry, WeightGoal } from './db'

// Days are integers counted from 1970-01-01 in the local calendar (DST can't shift them).

export function dayOf(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86400000)
}
export function dateOf(day: number) {
  return new Date(Math.round(day) * 86400000).toISOString().slice(0, 10)
}
export function localToday(now = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
/** Format a day with toLocaleDateString options (interpreted in UTC so the calendar day is exact). */
export function fmtDay(day: number, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return new Date(Math.round(day) * 86400000).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' })
}
export const fmtLb = (v: number) => (Math.round(v * 10) / 10).toFixed(1)

export interface TrendPoint {
  day: number
  weight: number
  trend: number
}

export const TREND_ALPHA = 0.07

/** One moving-average pass over a daily series, forward or backward. */
function ema(xs: number[], a: number, backward = false) {
  const out = new Array<number>(xs.length)
  const n = xs.length
  let e = 0
  for (let k = 0; k < n; k++) {
    const i = backward ? n - 1 - k : k
    e = k === 0 ? xs[i] : e + a * (xs[i] - e)
    out[i] = e
  }
  return out
}
/** Days the series is extended past each end before smoothing (about 3 time constants at 7%). */
const PAD = 42
/** Days at each end used for the straight-line fit that extends it. */
const FIT = 14

/** Least-squares line through ys (x = 0..n-1), extended to `len` values after the last point. */
function extendLine(ys: number[], len: number) {
  const n = ys.length
  if (n < 2) return new Array<number>(len).fill(ys[0])
  const mx = (n - 1) / 2
  const my = ys.reduce((a, v) => a + v, 0) / n
  let num = 0
  let den = 0
  ys.forEach((v, i) => {
    num += (i - mx) * (v - my)
    den += (i - mx) ** 2
  })
  const b = num / den
  return Array.from({ length: len }, (_, j) => my + b * (n + j - mx))
}

/**
 * Forward and backward passes averaged day by day: smooth, with no lag. Each end is first extended
 * with a straight line fit to its last two weeks, so the ends neither flatten out nor snap to the
 * latest weigh-in; the extension is trimmed off afterwards.
 */
function twoWay(xs: number[], a: number) {
  const n = xs.length
  const m = Math.min(FIT, n)
  const tail = extendLine(xs.slice(n - m), PAD)
  const head = extendLine(xs.slice(0, m).reverse(), PAD).reverse()
  const ext = [...head, ...xs, ...tail]
  const f = ema(ext, a)
  const b = ema(ext, a, true)
  return xs.map((_, i) => (f[i + PAD] + b[i + PAD]) / 2)
}

/**
 * Daily trend from the first weigh-in to the last. Gaps are filled with a straight line between
 * neighbouring weigh-ins (for the calculation only), then the two-way pass runs twice (ends extended along a two-week line fit).
 * `values[i]` is the trend on day `start + i`. Input sorted by day, one entry per day.
 */
export function trendSeries(sorted: { day: number; weight: number }[]) {
  if (sorted.length === 0) return { start: 0, values: [] as number[] }
  const start = sorted[0].day
  const filled: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (!b) filled.push(a.weight)
    else for (let d = a.day; d < b.day; d++) filled.push(a.weight + ((b.weight - a.weight) * (d - a.day)) / (b.day - a.day))
  }
  return { start, values: twoWay(twoWay(filled, TREND_ALPHA), TREND_ALPHA) }
}

/** Two-way smoothed trend at each weigh-in. Input any order. */
export function trendPoints(entries: Pick<WeightEntry, 'date' | 'weight'>[]): TrendPoint[] {
  const sorted = entries.map((e) => ({ day: dayOf(e.date), weight: e.weight })).sort((a, b) => a.day - b.day)
  const { start, values } = trendSeries(sorted)
  return sorted.map((e) => ({ ...e, trend: values[e.day - start] }))
}

/** Days between drawn line points, by visible span (the line gets less detail as you zoom out). */
export function lineStep(span: number) {
  if (span <= 40) return 1
  if (span <= 100) return 3
  if (span <= 200) return 7
  return 14
}

/**
 * Points the trend line is drawn through: every `step` days counted from the first weigh-in
 * (so the line doesn't shift while panning), plus the first and last weigh-in.
 */
export function linePoints(pts: TrendPoint[], step: number) {
  if (pts.length === 0) return []
  const { start, values } = trendSeries(pts)
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < values.length; i += step) out.push({ x: start + i, y: values[i] })
  const last = values.length - 1
  if (out.at(-1)!.x !== start + last) out.push({ x: start + last, y: values[last] })
  return out
}

/** Trend of the latest weigh-in on or before `day` (undefined if none). */
export function trendOnOrBefore(pts: TrendPoint[], day: number) {
  let v: number | undefined
  for (const p of pts) {
    if (p.day <= day) v = p.trend
    else break
  }
  return v
}

/** Trend at the start and end of a view, for the window change. Start falls back to the first weigh-in. */
export function windowChange(pts: TrendPoint[], v0: number, v1: number) {
  const end = trendOnOrBefore(pts, v1)
  const inView = pts.filter((p) => p.day > v0 && p.day <= v1)
  if (end == null || pts.length < 2 || inView.length === 0) return null
  const start = trendOnOrBefore(pts, v0) ?? pts[0].trend
  return end - start
}

/** Least-squares slope of the trend, lb per day: last 14 days, or 30 if fewer than 3 weigh-ins in 14. */
export function trendSlope(pts: TrendPoint[], today: number) {
  for (const days of [14, 30]) {
    const rec = pts.filter((p) => p.day > today - days && p.day <= today)
    if (rec.length >= 3 || (days === 30 && rec.length >= 2)) {
      const mx = rec.reduce((a, p) => a + p.day, 0) / rec.length
      const my = rec.reduce((a, p) => a + p.trend, 0) / rec.length
      const den = rec.reduce((a, p) => a + (p.day - mx) ** 2, 0)
      if (den === 0) return null
      return rec.reduce((a, p) => a + (p.day - mx) * (p.trend - my), 0) / den
    }
  }
  return null
}

export const MIN_WEIGHINS_FOR_PROJECTION = 7

export type Projection =
  | { kind: 'date'; day: number }
  | { kind: 'far' }
  | { kind: 'reached' }
  | { kind: 'away' }
  | { kind: 'few' }
  | { kind: 'none' }

/** Goal direction: fixed when the goal was set, else inferred from the current trend. */
export function goalDir(goal: WeightGoal, trend: number | undefined): 'down' | 'up' {
  if (goal.dir) return goal.dir
  return trend != null && goal.weight > trend ? 'up' : 'down'
}

export function projection(pts: TrendPoint[], goal: WeightGoal | undefined, today: number): Projection {
  if (!goal) return { kind: 'none' }
  const trend = pts.at(-1)?.trend
  if (trend == null) return { kind: 'few' }
  const dir = goalDir(goal, trend)
  if (dir === 'down' ? trend <= goal.weight : trend >= goal.weight) return { kind: 'reached' }
  if (pts.length < MIN_WEIGHINS_FOR_PROJECTION) return { kind: 'few' }
  const slope = trendSlope(pts, today)
  if (slope == null || slope === 0 || (dir === 'down' ? slope > 0 : slope < 0)) return { kind: 'away' }
  const days = (goal.weight - trend) / slope
  if (days > 730) return { kind: 'far' }
  return { kind: 'date', day: today + Math.ceil(days) }
}

// ---------- view, buckets, axes ----------

export type BucketKind = 'daily' | 'weekly' | 'biweekly' | 'monthly'
export const BUCKET_LABEL: Record<BucketKind, string> = {
  daily: 'daily',
  weekly: 'weekly avg',
  biweekly: '2-week avg',
  monthly: 'monthly avg',
}

/** Averaging by visible span (days). */
export function bucketKindFor(span: number): BucketKind {
  if (span > 200) return 'monthly'
  if (span > 100) return 'biweekly'
  if (span > 40) return 'weekly'
  return 'daily'
}

export type PresetId = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL'
export const PRESETS: PresetId[] = ['1W', '1M', '3M', '6M', '1Y', 'ALL']
const PRESET_DAYS: Record<Exclude<PresetId, 'ALL'>, number> = { '1W': 7, '1M': 30, '3M': 91, '6M': 182, '1Y': 365 }
export const MIN_SPAN = 7

/** Days from the first weigh-in through today, at least the minimum span. */
export function allSpan(pts: TrendPoint[], today: number) {
  return pts.length ? Math.max(MIN_SPAN, today - pts[0].day + 1) : 365
}
/** A preset's span, shrunk to the data when the range reaches back before the first weigh-in. */
export function presetSpan(id: PresetId, pts: TrendPoint[], today: number) {
  if (id === 'ALL') return allSpan(pts, today)
  return pts.length ? Math.min(PRESET_DAYS[id], allSpan(pts, today)) : PRESET_DAYS[id]
}
/** Zoom-out limit: all data (365 days before any weigh-ins exist). */
export function maxSpan(pts: TrendPoint[], today: number) {
  return allSpan(pts, today)
}
/** Earliest allowed view start: just before the first weigh-in (dots cover days after v0). */
export function minV0(pts: TrendPoint[], today: number) {
  return pts.length ? pts[0].day - 1 : today - 365
}
/**
 * Which preset the view matches exactly (ending today), if any. Clamped presets can share a span,
 * so the one last tapped (`chosen`) wins when it matches.
 */
export function matchPreset(v0: number, span: number, pts: TrendPoint[], today: number, chosen?: PresetId | null): PresetId | null {
  if (Math.abs(v0 + span - today) > 0.01) return null
  if (chosen && Math.abs(presetSpan(chosen, pts, today) - span) < 0.01) return chosen
  // ALL first: with short histories it can equal a smaller preset's span, and its averaging differs.
  for (const id of ['ALL', ...PRESETS.slice(0, 5)] as PresetId[]) if (Math.abs(presetSpan(id, pts, today) - span) < 0.01) return id
  return null
}

const mod = (a: number, n: number) => ((a % n) + n) % n
/** Monday of the week containing `day` (day 0, 1970-01-01, was a Thursday). */
export const mondayOf = (day: number) => day - mod(day + 3, 7)

/** Bucket key: the first day of the bucket. */
export function bucketStart(day: number, kind: BucketKind) {
  switch (kind) {
    case 'daily':
      return day
    case 'weekly':
      return mondayOf(day)
    case 'biweekly': {
      const m = mondayOf(day)
      return m - mod((m + 3) / 7, 2) * 7
    }
    case 'monthly': {
      const [y, mo] = dateOf(day).split('-').map(Number)
      return dayOf(`${y}-${String(mo).padStart(2, '0')}-01`)
    }
  }
}

/** Last day of the bucket that starts at `start`. */
export function bucketEnd(start: number, kind: BucketKind) {
  if (kind === 'daily') return start
  if (kind === 'weekly') return start + 6
  if (kind === 'biweekly') return start + 13
  const [y, mo] = dateOf(start).split('-').map(Number)
  return dayOf(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`) - 1
}

export interface Dot {
  key: number
  kind: BucketKind
  /** Mean day of the weigh-ins in it (x position). */
  day: number
  /** Mean weight. */
  weight: number
  n: number
}

/** Averaged dots for weigh-ins inside the view (v0, v1]. */
export function dots(pts: TrendPoint[], v0: number, v1: number, kind: BucketKind): Dot[] {
  const m = new Map<number, TrendPoint[]>()
  for (const p of pts) {
    if (p.day <= v0 || p.day > v1) continue
    const k = bucketStart(p.day, kind)
    const list = m.get(k)
    if (list) list.push(p)
    else m.set(k, [p])
  }
  return [...m.entries()].map(([key, list]) => ({
    key,
    kind,
    day: list.reduce((a, p) => a + p.day, 0) / list.length,
    weight: list.reduce((a, p) => a + p.weight, 0) / list.length,
    n: list.length,
  }))
}

/** Popup label for a dot's day or range. */
export function dotLabel(d: Dot, today: number) {
  if (d.kind === 'daily') return d.key === today ? 'Today' : fmtDay(d.key, { weekday: 'short', month: 'short', day: 'numeric' })
  if (d.kind === 'monthly') return fmtDay(d.key, { month: 'long', year: 'numeric' })
  return `${fmtDay(d.key)} – ${fmtDay(bucketEnd(d.key, d.kind))}`
}

/** Nice y range: step of 1, 2, 5, 10, 20 or 50 lb with at most 5 bands. */
export function yScale(values: number[]) {
  const mn = Math.min(...values)
  const mx = Math.max(...values)
  for (const step of [1, 2, 5, 10, 20, 50]) {
    const lo = Math.floor((mn - 0.3) / step) * step
    // At least two bands, so a flat stretch doesn't fill the whole height.
    const hi = Math.max(Math.ceil((mx + 0.3) / step) * step, lo + step * 2)
    if ((hi - lo) / step <= 5) return { lo, hi, step }
  }
  const step = 100
  return { lo: Math.floor(mn / step) * step, hi: Math.ceil(mx / step) * step + step, step }
}

export interface Tick {
  day: number
  label?: string
  labelDay?: number
}

/** Vertical gridlines and their labels for the view. */
export function xTicks(v0: number, v1: number): Tick[] {
  const span = v1 - v0
  const out: Tick[] = []
  if (span >= 60) {
    const [y0, m0] = dateOf(v0 - 31).split('-').map(Number)
    let y = y0
    let m = m0
    for (;;) {
      const start = dayOf(`${y}-${String(m).padStart(2, '0')}-01`)
      if (start > v1) break
      const mid = start + 14
      const label =
        mid > v0 + span * 0.04 && mid < v1 - span * 0.04 ? fmtDay(mid, { month: span > 200 ? 'narrow' : 'short' }) : undefined
      out.push({ day: start, label, labelDay: mid })
      m++
      if (m > 12) {
        m = 1
        y++
      }
    }
  } else {
    const step = span <= 14 ? 2 : 7
    // Weekly lines on Mondays; 2-day lines counted back from the right edge.
    let d = step === 7 ? mondayOf(Math.ceil(v0)) : Math.floor(v1) - Math.floor((Math.floor(v1) - Math.ceil(v0)) / 2) * 2
    if (d <= v0) d += step
    for (; d <= v1; d += step) {
      const label = d > v0 + span * 0.08 && d < v1 - span * 0.08 ? fmtDay(d) : undefined
      out.push({ day: d, label, labelDay: d })
    }
  }
  return out
}

// ---------- curve ----------

/**
 * Monotone cubic through (x, y) points (same method as the Progress chart): never overshoots a real value.
 * Returns the tangents so the same curve can be drawn and evaluated at any x.
 */
export function monotone(pts: { x: number; y: number }[]) {
  const n = pts.length
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x)
    slope.push(dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i])
  }
  const tan: number[] = n > 1 ? [slope[0]] : [0]
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) tan.push(0)
    else {
      const w1 = 2 * dx[i] + dx[i - 1]
      const w2 = dx[i] + 2 * dx[i - 1]
      tan.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]))
    }
  }
  if (n > 1) tan.push(slope[n - 2])

  /** y on the curve at x (clamped to the ends). */
  const at = (x: number) => {
    if (n === 0) return NaN
    if (x <= pts[0].x || n === 1) return pts[0].y
    if (x >= pts[n - 1].x) return pts[n - 1].y
    let i = 0
    while (i < n - 2 && x > pts[i + 1].x) i++
    const h = dx[i]
    const t = (x - pts[i].x) / h
    const t2 = t * t
    const t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * pts[i].y + (t3 - 2 * t2 + t) * h * tan[i] + (-2 * t3 + 3 * t2) * pts[i + 1].y + (t3 - t2) * h * tan[i + 1]
  }

  /** SVG path after mapping each point through (sx, sy), which must be affine. */
  const path = (sx: (x: number) => number, sy: (y: number) => number) => {
    if (n === 0) return ''
    const f = (v: number) => Math.round(v * 10) / 10
    let d = `M${f(sx(pts[0].x))},${f(sy(pts[0].y))}`
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3
      d += ` C${f(sx(pts[i].x + h))},${f(sy(pts[i].y + tan[i] * h))} ${f(sx(pts[i + 1].x - h))},${f(sy(pts[i + 1].y - tan[i + 1] * h))} ${f(sx(pts[i + 1].x))},${f(sy(pts[i + 1].y))}`
    }
    return d
  }
  return { at, path }
}

// ---------- trends and projections ----------

/** Trend now minus trend `days` ago (latest weigh-in on or before that day). All time, and a window longer than the data, start from the raw first weigh-in. */
export function trendChange(pts: TrendPoint[], today: number, days: number | 'all') {
  if (pts.length < 2) return null
  const now = pts.at(-1)!.trend
  const start = days === 'all' ? pts[0].weight : (trendOnOrBefore(pts, today - days) ?? pts[0].weight)
  return now - start
}

/** Overall rate, lb per day: from the raw first weigh-in to the current trend, over the days between. */
export function overallSlope(pts: TrendPoint[]) {
  if (pts.length < 2) return null
  const span = pts.at(-1)!.day - pts[0].day
  if (span < MIN_SPAN) return null
  return (pts.at(-1)!.trend - pts[0].weight) / span
}

export type RateId = 'current' | 'overall' | 'target'

/**
 * The three Projections rates, lb per day (signed: negative = losing).
 * Target is a positive lb/week pace; it points toward the goal (losing when there's no goal).
 */
export function rates(pts: TrendPoint[], today: number, goal: WeightGoal | undefined, targetPerWeek: number | undefined) {
  const dir = goal ? goalDir(goal, pts.at(-1)?.trend) : 'down'
  return {
    current: trendSlope(pts, today),
    overall: overallSlope(pts),
    target: targetPerWeek == null ? null : ((dir === 'down' ? -1 : 1) * targetPerWeek) / 7,
  } satisfies Record<RateId, number | null>
}

/** Weight `days` from the latest trend at `slope` lb/day. */
export function forecast(pts: TrendPoint[], slope: number, days: number) {
  const trend = pts.at(-1)?.trend
  return trend == null ? null : trend + slope * days
}

export type Eta = { kind: 'date'; days: number } | { kind: 'far' } | { kind: 'reached' } | { kind: 'away' } | { kind: 'few' }

/** When the trend reaches `target` at `slope` lb/day, counted from today. Same rules as the goal projection. */
export function etaTo(pts: TrendPoint[], target: number, dir: 'down' | 'up', slope: number | null): Eta {
  const trend = pts.at(-1)?.trend
  if (trend == null) return { kind: 'few' }
  if (dir === 'down' ? trend <= target : trend >= target) return { kind: 'reached' }
  if (pts.length < MIN_WEIGHINS_FOR_PROJECTION) return { kind: 'few' }
  if (slope == null || slope === 0 || (dir === 'down' ? slope > 0 : slope < 0)) return { kind: 'away' }
  const days = Math.ceil((target - trend) / slope)
  if (days > 730) return { kind: 'far' }
  return { kind: 'date', days }
}

/** Every 10 lb from the trend toward the goal, not including the goal itself (whole numbers). */
export function milestones(trend: number, goal: number, dir: 'down' | 'up') {
  const out: number[] = []
  if (dir === 'down') for (let w = Math.ceil(trend / 10) * 10 - 10; w > goal; w -= 10) out.push(w)
  else for (let w = Math.floor(trend / 10) * 10 + 10; w < goal; w += 10) out.push(w)
  return out
}

/** Progress from the raw first weigh-in to the goal: amount done (toward the goal, never below 0) and percent (0–100). */
export function goalProgress(pts: TrendPoint[], goal: number, dir: 'down' | 'up') {
  if (pts.length === 0) return null
  const start = pts[0].weight
  const now = pts.at(-1)!.trend
  const sign = dir === 'down' ? -1 : 1
  const total = sign * (goal - start)
  const done = Math.max(0, sign * (now - start))
  // A goal on the other side of the starting trend (e.g. a gain goal set while above it) counts as 0% until reached.
  const pct = total <= 0 ? 0 : Math.min(100, Math.max(0, (done / total) * 100))
  return { done, pct, toGo: Math.max(0, sign * (goal - now)) }
}

/** "in 5 days", "in 3 weeks", "in 10 months". */
export function relDays(n: number) {
  if (n <= 0) return 'today'
  const plural = (v: number, unit: string) => `in ${v} ${unit}${v === 1 ? '' : 's'}`
  if (n < 14) return plural(n, 'day')
  if (n < 60) return plural(Math.round(n / 7), 'week')
  return plural(Math.round(n / 30.44), 'month')
}

/** A future day as "Oct 11", with the year when it isn't this year ("Jul 26, 2027"). */
export function fmtFuture(day: number, today: number) {
  const sameYear = dateOf(day).slice(0, 4) === dateOf(today).slice(0, 4)
  return fmtDay(day, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}
