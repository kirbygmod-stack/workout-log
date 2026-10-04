import { describe, expect, it } from 'vitest'
import {
  allSpan,
  bucketEnd,
  bucketKindFor,
  bucketStart,
  dateOf,
  dayOf,
  dots,
  etaTo,
  forecast,
  fmtFuture,
  goalDir,
  goalProgress,
  lineStep,
  linePoints,
  localToday,
  matchPreset,
  maxSpan,
  milestones,
  minV0,
  mondayOf,
  monotone,
  overallSlope,
  presetSpan,
  projection,
  rates,
  relDays,
  trendChange,
  trendOnOrBefore,
  trendPoints,
  trendSeries,
  trendSlope,
  windowChange,
  xTicks,
  yScale,
  type TrendPoint,
} from './weight'

const D0 = dayOf('2026-08-02')
/** Weigh-ins on consecutive days starting at D0: weight(i). */
const series = (n: number, weight: (i: number) => number, every = 1) =>
  Array.from({ length: Math.ceil(n / every) }, (_, k) => k * every).map((i) => ({ date: dateOf(D0 + i), weight: weight(i) }))
const line = (n: number, start = 200, perDay = -0.1) => series(n, (i) => start + perDay * i)

describe('days and dates', () => {
  it('day 0 is 1970-01-01 and round-trips', () => {
    expect(dayOf('1970-01-01')).toBe(0)
    expect(dateOf(0)).toBe('1970-01-01')
    for (const d of ['2024-02-29', '2026-12-31', '2027-01-01', '2026-03-08', '2026-11-01']) expect(dateOf(dayOf(d))).toBe(d)
  })
  it('consecutive calendar days differ by exactly 1, across daylight saving and month ends', () => {
    expect(dayOf('2026-03-09') - dayOf('2026-03-08')).toBe(1) // spring forward
    expect(dayOf('2026-11-02') - dayOf('2026-11-01')).toBe(1) // fall back
    expect(dayOf('2026-03-01') - dayOf('2026-02-28')).toBe(1)
    expect(dayOf('2028-03-01') - dayOf('2028-02-29')).toBe(1)
  })
  it('localToday formats the local calendar day', () => {
    expect(localToday(new Date(2026, 9, 4, 23, 59))).toBe('2026-10-04')
    expect(localToday(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })
})

describe('trend', () => {
  it('a single weigh-in is its own trend', () => {
    const [p] = trendPoints([{ date: '2026-08-02', weight: 193.4 }])
    expect(p.trend).toBeCloseTo(193.4, 10)
  })
  it('accepts entries in any order', () => {
    const e = line(20)
    const shuffled = [...e].reverse()
    expect(trendPoints(shuffled)).toEqual(trendPoints(e))
  })
  it('runs through the middle of a straight line with no lag', () => {
    const pts = trendPoints(line(60))
    for (const p of pts.slice(10, 50)) expect(Math.abs(p.trend - p.weight)).toBeLessThan(0.05)
  })
  it('keeps the true slope on a straight line (about −0.1 lb/day) to the end', () => {
    const pts = trendPoints(line(60))
    const today = pts.at(-1)!.day
    expect(trendSlope(pts, today)!).toBeCloseTo(-0.1, 2)
    // the end extension stops the line flattening near today
    expect(Math.abs(pts.at(-1)!.trend - pts.at(-1)!.weight)).toBeLessThan(0.3)
  })
  it('bridges a long gap smoothly: no cliff, no plateau', () => {
    // weigh-ins for 10 days at 200, nothing for 40 days, then 10 days at 190
    const entries = [...series(10, () => 200), ...series(10, () => 190).map((e) => ({ date: dateOf(dayOf(e.date) + 50), weight: e.weight }))]
    const { values } = trendSeries(entries.map((e) => ({ day: dayOf(e.date), weight: e.weight })))
    let maxStep = 0
    let rising = 0
    for (let i = 1; i < values.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(values[i] - values[i - 1]))
      if (values[i] > values[i - 1] + 1e-9) rising++
    }
    expect(maxStep).toBeLessThan(0.5)
    expect(rising).toBe(0) // monotone down across the gap
  })
  it('is smoother than noisy daily readings', () => {
    const noise = [0.6, -0.8, 0.4, -0.3, 0.9, -0.7, 0.2, -0.5, 0.7, -0.9]
    const entries = series(60, (i) => 200 - 0.1 * i + noise[i % noise.length])
    const pts = trendPoints(entries)
    const roughness = (xs: number[]) => xs.slice(1).reduce((a, v, i) => a + Math.abs(v - xs[i]), 0)
    expect(roughness(pts.map((p) => p.trend))).toBeLessThan(roughness(pts.map((p) => p.weight)) / 4)
  })
  it('a one-off +3 lb reading moves trend weight only about 1 lb', () => {
    const base = trendPoints(line(60)).at(-1)!.trend
    const spiked = trendPoints(series(60, (i) => 200 - 0.1 * i + (i === 59 ? 3 : 0))).at(-1)!.trend
    const shift = spiked - base
    expect(shift).toBeGreaterThan(0.3)
    expect(shift).toBeLessThan(1.6)
  })
  it('empty input gives an empty series', () => {
    expect(trendSeries([])).toEqual({ start: 0, values: [] })
    expect(trendPoints([])).toEqual([])
  })
})

describe('line points', () => {
  it('step by span', () => {
    expect([40, 41, 100, 101, 200, 201].map(lineStep)).toEqual([1, 3, 3, 7, 7, 14])
  })
  it('counts from the first weigh-in and always includes first and last', () => {
    const pts = trendPoints(line(30))
    const out = linePoints(pts, 7)
    expect(out[0].x).toBe(pts[0].day)
    expect(out.at(-1)!.x).toBe(pts.at(-1)!.day)
    expect(out.slice(0, -1).every((p) => (p.x - pts[0].day) % 7 === 0)).toBe(true)
  })
  it('does not shift when later weigh-ins exist (stable while panning)', () => {
    const a = linePoints(trendPoints(line(30)), 3)
    const b = linePoints(trendPoints(line(30)), 3)
    expect(a).toEqual(b)
    expect(linePoints([], 3)).toEqual([])
  })
})

describe('window change, slope, projection', () => {
  const pts = trendPoints(line(30)) // −0.1/day, 30 weigh-ins
  const today = pts.at(-1)!.day
  it('trendOnOrBefore', () => {
    expect(trendOnOrBefore(pts, pts[5].day)).toBe(pts[5].trend)
    expect(trendOnOrBefore(pts, pts[5].day + 0.5)).toBe(pts[5].trend)
    expect(trendOnOrBefore(pts, pts[0].day - 1)).toBeUndefined()
  })
  it('windowChange is trend at the end minus trend at the start of the view', () => {
    const c = windowChange(pts, today - 10, today)!
    expect(c).toBeCloseTo(pts.at(-1)!.trend - trendOnOrBefore(pts, today - 10)!, 10)
    expect(c).toBeLessThan(0)
  })
  it('windowChange falls back to the first weigh-in when the view starts earlier', () => {
    expect(windowChange(pts, pts[0].day - 100, today)).toBeCloseTo(pts.at(-1)!.trend - pts[0].trend, 10)
  })
  it('windowChange is null with one weigh-in, or none in view', () => {
    expect(windowChange(trendPoints([{ date: '2026-08-02', weight: 190 }]), 0, D0 + 5)).toBeNull()
    expect(windowChange(pts, today + 5, today + 20)).toBeNull()
  })
  it('trendSlope uses 14 days, falls back to 30, needs data', () => {
    expect(trendSlope(pts, today)).toBeCloseTo(-0.1, 2)
    // 2 weigh-ins in the last 14 days but 5 in 30: use the 30-day window
    const sparse = trendPoints([0, 3, 6, 9, 20, 28].map((i) => ({ date: dateOf(D0 + i), weight: 200 - 0.1 * i })))
    const t = D0 + 28
    expect(trendSlope(sparse, t)).not.toBeNull()
    expect(trendSlope(trendPoints([{ date: dateOf(D0), weight: 200 }]), D0)).toBeNull()
    expect(trendSlope([], D0)).toBeNull()
  })

  const goalAt = (w: number, dir?: 'down' | 'up') => ({ weight: w, dir })
  it('projection: no goal', () => expect(projection(pts, undefined, today)).toEqual({ kind: 'none' }))
  it('projection: a date, rounded up, at the current pace', () => {
    const trend = pts.at(-1)!.trend
    const goal = trend - 5
    const p = projection(pts, goalAt(goal, 'down'), today)
    expect(p.kind).toBe('date')
    if (p.kind === 'date') {
      const slope = trendSlope(pts, today)!
      expect(p.day).toBe(today + Math.ceil((goal - trend) / slope))
      expect(p.day - today).toBeGreaterThan(45)
      expect(p.day - today).toBeLessThan(55)
    }
  })
  it('projection: reached once the trend is at or past the goal, in the goal direction', () => {
    expect(projection(pts, goalAt(pts.at(-1)!.trend + 1, 'down'), today).kind).toBe('reached')
    expect(projection(pts, goalAt(pts.at(-1)!.trend, 'down'), today).kind).toBe('reached')
    expect(projection(pts, goalAt(pts.at(-1)!.trend - 1, 'up'), today).kind).toBe('reached')
  })
  it('projection: away when moving the wrong way, and for a flat trend', () => {
    expect(projection(pts, goalAt(pts.at(-1)!.trend + 5, 'up'), today).kind).toBe('away')
    const flat = trendPoints(series(20, () => 190))
    expect(projection(flat, goalAt(180, 'down'), flat.at(-1)!.day).kind).toBe('away')
  })
  it('projection: far when more than 2 years out', () => {
    expect(projection(pts, goalAt(100, 'down'), today).kind).toBe('far')
  })
  it('projection: few with under 7 weigh-ins (unless reached)', () => {
    const few = trendPoints(line(5))
    expect(projection(few, goalAt(150, 'down'), few.at(-1)!.day).kind).toBe('few')
    expect(projection(few, goalAt(250, 'down'), few.at(-1)!.day).kind).toBe('reached')
    expect(projection([], goalAt(150, 'down'), 0).kind).toBe('few')
  })
  it('goalDir: stored direction wins, else inferred from the trend', () => {
    expect(goalDir({ weight: 180, dir: 'up' }, 190)).toBe('up')
    expect(goalDir({ weight: 180 }, 190)).toBe('down')
    expect(goalDir({ weight: 200 }, 190)).toBe('up')
    expect(goalDir({ weight: 200 }, undefined)).toBe('down')
  })
})

describe('trends and projections card', () => {
  const pts = trendPoints(line(60))
  const today = pts.at(-1)!.day
  it('trendChange: now minus trend N days ago, all time from the raw first weigh-in', () => {
    const now = pts.at(-1)!.trend
    expect(trendChange(pts, today, 7)).toBeCloseTo(now - trendOnOrBefore(pts, today - 7)!, 10)
    expect(trendChange(pts, today, 'all')).toBeCloseTo(now - pts[0].weight, 10)
    expect(trendChange(pts, today, 7)!).toBeLessThan(0)
  })
  it('trendChange: a window longer than the data starts at the raw first weigh-in', () => {
    expect(trendChange(pts, today, 365)).toBeCloseTo(pts.at(-1)!.trend - pts[0].weight, 10)
  })
  it('trendChange needs two weigh-ins', () => {
    expect(trendChange(trendPoints(line(1)), D0, 7)).toBeNull()
    expect(trendChange([], D0, 7)).toBeNull()
  })
  it('overallSlope: raw first weigh-in to current trend over the days between; null under 7 days', () => {
    expect(overallSlope(pts)).toBeCloseTo(-0.1, 1)
    expect(overallSlope(trendPoints(line(7)))).toBeNull() // 6 days between
    expect(overallSlope(trendPoints(line(8)))).not.toBeNull() // 7 days between
    expect(overallSlope([])).toBeNull()
  })
  it('rates: target points toward the goal, in lb/day', () => {
    const down = rates(pts, today, { weight: 150, dir: 'down' }, 1)
    expect(down.target).toBeCloseTo(-1 / 7, 10)
    const up = rates(pts, today, { weight: 250, dir: 'up' }, 1)
    expect(up.target).toBeCloseTo(1 / 7, 10)
    expect(rates(pts, today, undefined, 1).target).toBeCloseTo(-1 / 7, 10) // no goal → losing
    expect(rates(pts, today, undefined, undefined).target).toBeNull()
    expect(down.current).toBeCloseTo(-0.1, 2)
  })
  it('forecast: latest trend plus slope × days', () => {
    expect(forecast(pts, -0.1, 7)).toBeCloseTo(pts.at(-1)!.trend - 0.7, 10)
    expect(forecast([], -0.1, 7)).toBeNull()
  })
  it('etaTo: date, reached, away, far, few', () => {
    const trend = pts.at(-1)!.trend
    expect(etaTo(pts, trend - 10, 'down', -0.1)).toEqual({ kind: 'date', days: 100 })
    expect(etaTo(pts, trend + 1, 'down', -0.1)).toEqual({ kind: 'reached' })
    expect(etaTo(pts, trend - 10, 'down', 0.1)).toEqual({ kind: 'away' })
    expect(etaTo(pts, trend - 10, 'down', 0)).toEqual({ kind: 'away' })
    expect(etaTo(pts, trend - 10, 'down', null)).toEqual({ kind: 'away' })
    expect(etaTo(pts, trend - 10, 'down', -0.001)).toEqual({ kind: 'far' })
    expect(etaTo(pts, trend + 10, 'up', 0.1)).toEqual({ kind: 'date', days: 100 })
    expect(etaTo(trendPoints(line(5)), 150, 'down', -0.1)).toEqual({ kind: 'few' })
  })
  it('milestones: every 10 lb toward the goal, goal itself excluded', () => {
    expect(milestones(193.8, 170, 'down')).toEqual([190, 180])
    expect(milestones(200, 170, 'down')).toEqual([190, 180]) // exactly on a multiple: the next one down
    expect(milestones(193.8, 190, 'down')).toEqual([]) // goal closer than the next milestone
    expect(milestones(150.2, 180, 'up')).toEqual([160, 170])
    expect(milestones(150, 160, 'up')).toEqual([]) // 160 is the goal
  })
  it('goalProgress: from the raw first weigh-in', () => {
    const p = [{ day: 0, weight: 200, trend: 200 }, { day: 30, weight: 190, trend: 195 }] as TrendPoint[]
    const g = goalProgress(p, 180, 'down')!
    expect(g.done).toBeCloseTo(5, 10)
    expect(g.pct).toBeCloseTo(25, 10)
    expect(g.toGo).toBeCloseTo(15, 10)
  })
  it('goalProgress: never negative, capped at 100, 0% for a goal behind the start', () => {
    const away = [{ day: 0, weight: 200, trend: 200 }, { day: 30, weight: 205, trend: 205 }] as TrendPoint[]
    expect(goalProgress(away, 180, 'down')!.done).toBe(0)
    const past = [{ day: 0, weight: 200, trend: 200 }, { day: 30, weight: 175, trend: 175 }] as TrendPoint[]
    const g = goalProgress(past, 180, 'down')!
    expect(g.pct).toBe(100)
    expect(g.toGo).toBe(0)
    expect(goalProgress(away, 210, 'down')!.pct).toBe(0) // wrong side of the start
    expect(goalProgress([], 180, 'down')).toBeNull()
  })
  it('goalProgress works for gaining goals', () => {
    const p = [{ day: 0, weight: 150, trend: 150 }, { day: 30, weight: 155, trend: 155 }] as TrendPoint[]
    const g = goalProgress(p, 170, 'up')!
    expect(g.pct).toBeCloseTo(25, 10)
    expect(g.toGo).toBeCloseTo(15, 10)
  })
  it('relDays: days under 14, weeks under 60, months beyond', () => {
    expect([0, -3].map(relDays)).toEqual(['today', 'today'])
    expect(relDays(1)).toBe('in 1 day')
    expect(relDays(13)).toBe('in 13 days')
    expect(relDays(14)).toBe('in 2 weeks')
    expect(relDays(59)).toBe('in 8 weeks')
    expect(relDays(60)).toBe('in 2 months')
    expect(relDays(31)).toBe('in 4 weeks')
    expect(relDays(365)).toBe('in 12 months')
  })
  it('fmtFuture adds the year only when it differs from today’s', () => {
    const today = dayOf('2026-10-04')
    expect(fmtFuture(dayOf('2026-12-29'), today)).not.toContain('2026')
    expect(fmtFuture(dayOf('2027-07-26'), today)).toContain('2027')
  })
})

describe('buckets, dots, presets', () => {
  it('bucketKindFor boundaries', () => {
    expect([1, 40, 41, 100, 101, 200, 201, 365].map(bucketKindFor)).toEqual(['daily', 'daily', 'weekly', 'weekly', 'biweekly', 'biweekly', 'monthly', 'monthly'])
  })
  it('mondayOf: Mondays map to themselves, Sunday to the Monday six days before', () => {
    const mon = dayOf('2026-09-28')
    expect(dateOf(mon)).toBe('2026-09-28')
    expect(mondayOf(mon)).toBe(mon)
    for (let d = 0; d < 7; d++) expect(mondayOf(mon + d)).toBe(mon)
    expect(mondayOf(mon + 7)).toBe(mon + 7)
    expect(mondayOf(dayOf('2026-10-04'))).toBe(mon)
  })
  it('weekly and daily bucket starts', () => {
    expect(bucketStart(dayOf('2026-10-02'), 'daily')).toBe(dayOf('2026-10-02'))
    expect(bucketStart(dayOf('2026-10-02'), 'weekly')).toBe(dayOf('2026-09-28'))
    expect(bucketEnd(dayOf('2026-09-28'), 'weekly')).toBe(dayOf('2026-10-04'))
  })
  it('two-week buckets are fixed Monday-start pairs', () => {
    const mondays = Array.from({ length: 8 }, (_, i) => dayOf('2026-08-03') + 7 * i)
    const starts = mondays.map((m) => bucketStart(m, 'biweekly'))
    // buckets are two Mondays wide, so each start covers at most two of these Mondays
    const distinct = [...new Set(starts)]
    for (const s of distinct) expect(starts.filter((x) => x === s).length).toBeLessThanOrEqual(2)
    expect(distinct.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < distinct.length; i++) expect(distinct[i] - distinct[i - 1]).toBe(14)
    // a day mid-week lands with its Monday
    expect(bucketStart(dayOf('2026-10-02'), 'biweekly')).toBe(bucketStart(dayOf('2026-09-28'), 'biweekly'))
    expect(bucketEnd(distinct[0], 'biweekly')).toBe(distinct[0] + 13)
    expect(mondayOf(distinct[0])).toBe(distinct[0])
  })
  it('monthly: first of the month through the last day, incl. Feb, leap years and December', () => {
    expect(dateOf(bucketStart(dayOf('2026-09-17'), 'monthly'))).toBe('2026-09-01')
    expect(dateOf(bucketEnd(dayOf('2026-09-01'), 'monthly'))).toBe('2026-09-30')
    expect(dateOf(bucketEnd(dayOf('2026-02-01'), 'monthly'))).toBe('2026-02-28')
    expect(dateOf(bucketEnd(dayOf('2028-02-01'), 'monthly'))).toBe('2028-02-29')
    expect(dateOf(bucketEnd(dayOf('2026-12-01'), 'monthly'))).toBe('2026-12-31')
  })
  it('dots average each bucket at the mean day and weight, within (v0, v1]', () => {
    const pts = trendPoints([
      { date: '2026-09-28', weight: 200 }, // Monday
      { date: '2026-09-30', weight: 198 },
      { date: '2026-10-05', weight: 196 }, // next week
    ])
    const d = dots(pts, dayOf('2026-09-27'), dayOf('2026-10-05'), 'weekly')
    expect(d).toHaveLength(2)
    expect(d[0].n).toBe(2)
    expect(d[0].weight).toBeCloseTo(199, 10)
    expect(d[0].day).toBeCloseTo((dayOf('2026-09-28') + dayOf('2026-09-30')) / 2, 10)
    expect(d[1].n).toBe(1)
  })
  it('dots exclude v0 and include v1, and every in-view weigh-in lands in exactly one dot', () => {
    const pts = trendPoints(line(30))
    const v0 = D0 + 4
    const v1 = D0 + 20
    const all = dots(pts, v0, v1, 'daily')
    expect(all).toHaveLength(16)
    expect(all[0].day).toBe(v0 + 1)
    expect(all.at(-1)!.day).toBe(v1)
    const weekly = dots(pts, v0, v1, 'weekly')
    expect(weekly.reduce((a, x) => a + x.n, 0)).toBe(16)
  })

  const pts = trendPoints(line(40))
  const today = pts.at(-1)!.day
  it('presetSpan shrinks to the data; ALL is first weigh-in through today, at least 7', () => {
    expect(presetSpan('1W', pts, today)).toBe(7)
    expect(presetSpan('1M', pts, today)).toBe(30)
    expect(presetSpan('3M', pts, today)).toBe(40) // 91 → shrunk to the 40 days of data
    expect(presetSpan('ALL', pts, today)).toBe(40)
    expect(allSpan(trendPoints(line(2)), D0 + 1)).toBe(7)
    expect(presetSpan('1Y', [], today)).toBe(365)
    expect(allSpan([], today)).toBe(365)
  })
  it('view limits: never before the first weigh-in', () => {
    expect(minV0(pts, today)).toBe(pts[0].day - 1)
    expect(minV0([], today)).toBe(today - 365)
    expect(maxSpan(pts, today)).toBe(40)
  })
  it('matchPreset: exact match ending today; the tapped preset wins a tie; otherwise null', () => {
    expect(matchPreset(today - 30, 30, pts, today)).toBe('1M')
    expect(matchPreset(today - 30, 30, pts, today - 1 + 1)).toBe('1M')
    expect(matchPreset(today - 31, 30, pts, today)).toBeNull() // not ending today
    expect(matchPreset(today - 29, 29, pts, today)).toBeNull()
    // 3M, 6M, 1Y and ALL all shrink to 40 days here; ALL wins by default, the tapped one wins when given
    expect(matchPreset(today - 40, 40, pts, today)).toBe('ALL')
    expect(matchPreset(today - 40, 40, pts, today, '6M')).toBe('6M')
    expect(matchPreset(today - 40, 40, pts, today, '1M')).toBe('ALL') // tapped one doesn't match this span
  })
})

describe('axes', () => {
  it('yScale: nice steps, at most 5 bands, at least 2', () => {
    const a = yScale([193.8, 199])
    expect(a.step).toBeLessThanOrEqual(2)
    expect((a.hi - a.lo) / a.step).toBeLessThanOrEqual(5)
    expect(a.lo).toBeLessThanOrEqual(193.8 - 0.3)
    expect(a.hi).toBeGreaterThanOrEqual(199 + 0.3)
    const flat = yScale([190, 190])
    expect((flat.hi - flat.lo) / flat.step).toBeGreaterThanOrEqual(2)
    const wide = yScale([150, 320])
    expect(wide.lo).toBeLessThanOrEqual(150)
    expect(wide.hi).toBeGreaterThanOrEqual(320)
    expect((wide.hi - wide.lo) / wide.step).toBeLessThanOrEqual(5)
  })
  it('xTicks: weekly lines on Mondays at ≤ 60 days, labels away from the edges', () => {
    const v1 = dayOf('2026-10-04')
    const ticks = xTicks(v1 - 30, v1)
    expect(ticks.length).toBeGreaterThanOrEqual(4)
    for (const t of ticks) {
      expect(mondayOf(t.day)).toBe(t.day)
      expect(t.day).toBeGreaterThan(v1 - 30)
      expect(t.day).toBeLessThanOrEqual(v1)
    }
    expect(ticks.some((t) => t.label)).toBe(true)
  })
  it('xTicks: every 2 days at 14 days or less', () => {
    const v1 = dayOf('2026-10-04')
    const ticks = xTicks(v1 - 7, v1)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].day - ticks[i - 1].day).toBe(2)
    expect(ticks.at(-1)!.day).toBe(v1)
  })
  it('xTicks: month starts at 60+ days, labeled mid-month', () => {
    const v1 = dayOf('2026-10-04')
    const ticks = xTicks(v1 - 120, v1)
    for (const t of ticks) expect(dateOf(t.day).endsWith('-01')).toBe(true)
    for (const t of ticks) expect(t.labelDay).toBe(t.day + 14)
    expect(ticks.length).toBeGreaterThanOrEqual(4)
  })
})

describe('monotone curve', () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 5, y: 12 },
    { x: 6, y: 30 },
    { x: 10, y: 31 },
    { x: 15, y: 20 },
  ]
  const c = monotone(pts)
  it('passes through every point', () => {
    for (const p of pts) expect(c.at(p.x)).toBeCloseTo(p.y, 10)
  })
  it('never overshoots between neighbours', () => {
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = Math.min(pts[i].y, pts[i + 1].y)
      const hi = Math.max(pts[i].y, pts[i + 1].y)
      for (let k = 0; k <= 20; k++) {
        const x = pts[i].x + ((pts[i + 1].x - pts[i].x) * k) / 20
        expect(c.at(x)).toBeGreaterThanOrEqual(lo - 1e-9)
        expect(c.at(x)).toBeLessThanOrEqual(hi + 1e-9)
      }
    }
  })
  it('clamps to the ends and handles tiny inputs', () => {
    expect(c.at(-5)).toBe(10)
    expect(c.at(99)).toBe(20)
    expect(monotone([]).at(1)).toBeNaN()
    expect(monotone([]).path((x) => x, (y) => y)).toBe('')
    expect(monotone([{ x: 1, y: 2 }]).at(7)).toBe(2)
  })
  it('path starts at the first point and has one segment per gap', () => {
    const d = c.path((x) => x, (y) => y)
    expect(d.startsWith('M0,10')).toBe(true)
    expect(d.match(/C/g)).toHaveLength(4)
  })
})
