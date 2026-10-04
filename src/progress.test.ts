import { describe, expect, it } from 'vitest'
import type { Exercise, SetEntry, Workout, WorkoutType } from './db'
import {
  change,
  fmtDiff,
  fmtPct,
  fmtSpan,
  rangeStart,
  scalePoints,
  sessionPoints,
  smoothPath,
  volumeBetween,
  weekStart,
  weeklyStrengthChange,
  weeklyVolume,
} from './progress'
import { volume } from './stats'

const DAY = 86400000
// All dates are local (the test zone is America/New_York, see vitest.config.ts).
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()

describe('weekStart (Monday 00:00 local)', () => {
  it('maps every day of a week to its Monday', () => {
    const monday = at(2026, 9, 28, 0)
    for (let d = 0; d < 7; d++) expect(weekStart(at(2026, 9, 28 + d, 15))).toBe(monday)
  })
  it('Sunday belongs to the week that started the Monday before', () => {
    expect(weekStart(at(2026, 10, 4, 2))).toBe(at(2026, 9, 28, 0))
  })
  it('the next Monday starts a new week', () => {
    expect(weekStart(at(2026, 10, 5, 0))).toBe(at(2026, 10, 5, 0))
  })
  it('holds across the daylight saving change (Nov 1, 2026)', () => {
    expect(weekStart(at(2026, 11, 1, 20))).toBe(at(2026, 10, 26, 0))
    expect(weekStart(at(2026, 11, 2, 1))).toBe(at(2026, 11, 2, 0))
  })
})

describe('rangeStart', () => {
  const now = at(2026, 10, 4, 9)
  it('ALL is 0', () => expect(rangeStart('ALL', now)).toBe(0))
  it('goes back whole months to local midnight', () => {
    expect(rangeStart('1M', now)).toBe(at(2026, 9, 4, 0))
    expect(rangeStart('2M', now)).toBe(at(2026, 8, 4, 0))
    expect(rangeStart('6M', now)).toBe(at(2026, 4, 4, 0))
    expect(rangeStart('1Y', now)).toBe(at(2025, 10, 4, 0))
  })
})

describe('sessionPoints / change / formatting', () => {
  const workouts = new Map<number, Workout>([
    [1, { id: 1, type: 'push', startedAt: 1000 }],
    [2, { id: 2, type: 'push', startedAt: 2000 }],
  ])
  const s = (workoutId: number, weight: number | undefined, reps: number | undefined): SetEntry => ({
    workoutExerciseId: workoutId,
    workoutId,
    exerciseId: 1,
    completedAt: workoutId * 1000 + 5,
    weight,
    reps,
  })
  it('one point per workout, the best e1RM, oldest first', () => {
    const pts = sessionPoints([s(2, 100, 5), s(1, 100, 5), s(1, 110, 3), s(2, 90, 5)], workouts)
    expect(pts.map((p) => p.t)).toEqual([1000, 2000])
    expect(pts[0].best.weight).toBe(110) // 110×3 = 121 beats 100×5 = 116.7
    expect(pts[1].best.weight).toBe(100)
  })
  it('skips sets with no e1RM', () => {
    expect(sessionPoints([s(1, 0, 5), s(1, 100, 0), s(1, undefined, 8)], workouts)).toEqual([])
  })
  it('change is last minus first, with percent', () => {
    const c = change([
      { t: 1, value: 100, best: s(1, 1, 1) },
      { t: 2, value: 90, best: s(1, 1, 1) },
      { t: 3, value: 110, best: s(1, 1, 1) },
    ])
    expect(c).toEqual({ diff: 10, pct: 10, up: true })
  })
  it('change needs two points', () => {
    expect(change([])).toBeNull()
    expect(change([{ t: 1, value: 100, best: s(1, 1, 1) }])).toBeNull()
  })
  it('formats with a true minus sign', () => {
    expect(fmtDiff({ diff: 15.4, pct: 0, up: true })).toBe('+15 lb')
    expect(fmtDiff({ diff: -4.6, pct: 0, up: false })).toBe('−5 lb')
    expect(fmtPct(2.44)).toBe('+2.4%')
    expect(fmtPct(-2.44)).toBe('−2.4%')
    expect(fmtPct(-0.04)).toBe('+0.0%') // a drop that rounds to zero reads as +0.0% here (the Start tiles handle this separately)
    expect(fmtPct(0)).toBe('+0.0%')
  })
  it('fmtSpan picks days, weeks or months', () => {
    const p = (t: number) => ({ t, value: 1, best: s(1, 1, 1) })
    expect(fmtSpan([p(0)])).toBe('')
    expect(fmtSpan([p(0), p(5 * DAY)])).toBe('5 days')
    expect(fmtSpan([p(0), p(DAY)])).toBe('1 day')
    expect(fmtSpan([p(0), p(56 * DAY)])).toBe('8 wks')
    expect(fmtSpan([p(0), p(180 * DAY)])).toBe('6 mo')
  })
})

describe('weekly volume', () => {
  const kindOf = (id: number): Exercise['kind'] | undefined => (id === 1 ? 'weight' : id === 2 ? 'bodyweight' : undefined)
  const mk = (exerciseId: number, completedAt: number, weight: number | undefined, reps: number | undefined): SetEntry => ({
    workoutExerciseId: 1,
    workoutId: 1,
    exerciseId,
    completedAt,
    weight,
    reps,
  })
  const now = at(2026, 10, 4, 10) // Sunday: this week is Sep 28 – Oct 4
  it('returns n weeks oldest first, ending with this week', () => {
    const w = weeklyVolume([], kindOf, now, 8)
    expect(w).toHaveLength(8)
    expect(w.at(-1)!.start).toBe(at(2026, 9, 28, 0))
    expect(w[0].start).toBe(at(2026, 8, 10, 0))
  })
  it('buckets weighted sets into their week and ignores the rest', () => {
    const sets = [
      mk(1, at(2026, 9, 29), 100, 10), // this week
      mk(1, at(2026, 10, 4, 23), 50, 10), // Sunday night, still this week
      mk(1, at(2026, 9, 22), 200, 5), // last week
      mk(2, at(2026, 9, 29), 25, 10), // bodyweight: not counted
      mk(1, at(2026, 9, 29), 0, 10), // no weight
      mk(1, at(2026, 6, 1), 100, 10), // before the window
    ]
    const w = weeklyVolume(sets, kindOf, now, 8)
    expect(w.at(-1)!.volume).toBe(1500)
    expect(w.at(-2)!.volume).toBe(1000)
    expect(w.reduce((a, x) => a + x.volume, 0)).toBe(2500)
  })
  it('weeks stay Monday-aligned across the daylight saving change', () => {
    const w = weeklyVolume([], kindOf, at(2026, 11, 8, 10), 3)
    expect(w.map((x) => x.start)).toEqual([at(2026, 10, 19, 0), at(2026, 10, 26, 0), at(2026, 11, 2, 0)])
    for (const x of w) expect(new Date(x.start).getDay()).toBe(1)
    for (const x of w) expect(new Date(x.start).getHours()).toBe(0)
  })
  it('weekly volume, volumeBetween and volume() agree on the same sets', () => {
    const sets = [mk(1, at(2026, 10, 1), 100, 10), mk(1, at(2026, 10, 2), 50, 3), mk(2, at(2026, 10, 1), 25, 10), mk(1, at(2026, 10, 3), 0, 10)]
    const week = weeklyVolume(sets, kindOf, now, 1)[0].volume
    expect(week).toBe(1150)
    expect(volumeBetween(sets, kindOf, at(2026, 9, 28, 0), at(2026, 10, 5, 0))).toBe(week)
    expect(volume(sets, kindOf)).toBe(week)
  })
  it('volumeBetween is [from, to) and weighted lifts only', () => {
    const sets = [mk(1, 1000, 10, 10), mk(1, 2000, 10, 10), mk(2, 1500, 10, 10)]
    expect(volumeBetween(sets, kindOf, 1000, 2000)).toBe(100)
    expect(volumeBetween(sets, kindOf, 0, 3000)).toBe(200)
  })
})

describe('weeklyStrengthChange', () => {
  const kinds: Record<number, Exercise['kind']> = { 1: 'weight', 2: 'weight', 3: 'weight', 4: 'bodyweight', 5: 'cardio' }
  const kindOf = (id: number) => kinds[id]
  let nextId = 0
  const wk = (type: WorkoutType, startedAt: number): Workout => ({ id: ++nextId, type, startedAt })
  const st = (w: Workout, exerciseId: number, weight: number, reps: number): SetEntry => ({
    workoutExerciseId: 1,
    workoutId: w.id!,
    exerciseId,
    completedAt: w.startedAt + 1000,
    weight,
    reps,
  })
  // Two Push workouts in consecutive weeks: Sep 21 (Mon) and Sep 28 (Mon).
  const wkA = wk('push', at(2026, 9, 21))
  const wkB = wk('push', at(2026, 9, 28))

  it('averages per-exercise e1RM change, each exercise weighted equally', () => {
    // Exercise 1: 100×1 → 110×1 (+10%). Exercise 2: 200×1 → 190×1 (−5%). Mean = +2.5%.
    const sets = [st(wkA, 1, 100, 1), st(wkB, 1, 110, 1), st(wkA, 2, 200, 1), st(wkB, 2, 190, 1)]
    const r = weeklyStrengthChange(sets, [wkA, wkB], kindOf)
    expect(r.push).toBeCloseTo(2.5, 10)
    expect(r.pull).toBeNull()
    expect(r.legs).toBeNull()
    expect(r.other).toBeNull()
  })
  it('uses the best e1RM of the week, not the last set', () => {
    const sets = [st(wkA, 1, 100, 1), st(wkA, 1, 50, 1), st(wkB, 1, 110, 1), st(wkB, 1, 60, 1), st(wkA, 2, 100, 1), st(wkB, 2, 100, 1)]
    expect(weeklyStrengthChange(sets, [wkA, wkB], kindOf).push).toBeCloseTo(5, 10) // (+10% and 0%) / 2
  })
  it('leaves out an exercise not trained in the anchor week', () => {
    const sets = [st(wkA, 1, 100, 1), st(wkB, 1, 110, 1), st(wkA, 2, 100, 1), st(wkB, 2, 120, 1), st(wkA, 3, 100, 1)]
    // exercise 3 only in the earlier week: ignored, not counted as −100%
    expect(weeklyStrengthChange(sets, [wkA, wkB], kindOf).push).toBeCloseTo(15, 10)
  })
  it('leaves out a new exercise with no earlier week', () => {
    const sets = [st(wkA, 1, 100, 1), st(wkB, 1, 110, 1), st(wkA, 2, 100, 1), st(wkB, 2, 120, 1), st(wkB, 3, 50, 1)]
    expect(weeklyStrengthChange(sets, [wkA, wkB], kindOf).push).toBeCloseTo(15, 10)
  })
  it('ignores bodyweight, cardio and zero-weight or zero-rep sets', () => {
    const sets = [
      st(wkA, 1, 100, 1),
      st(wkB, 1, 110, 1),
      st(wkA, 2, 100, 1),
      st(wkB, 2, 120, 1),
      st(wkA, 4, 10, 8),
      st(wkB, 4, 50, 8),
      st(wkA, 5, 10, 8),
      st(wkB, 5, 50, 8),
      st(wkA, 3, 100, 0),
      st(wkB, 3, 200, 5),
      st(wkB, 3, 0, 5),
    ]
    expect(weeklyStrengthChange(sets, [wkA, wkB], kindOf).push).toBeCloseTo(15, 10)
  })
  it('shows null with fewer than 2 qualifying exercises', () => {
    expect(weeklyStrengthChange([st(wkA, 1, 100, 1), st(wkB, 1, 110, 1)], [wkA, wkB], kindOf).push).toBeNull()
  })
  it('minExercises can be lowered', () => {
    expect(weeklyStrengthChange([st(wkA, 1, 100, 1), st(wkB, 1, 110, 1)], [wkA, wkB], kindOf, 1).push).toBeCloseTo(10, 10)
  })
  it('a skipped week moves the anchor back instead of blanking the tile', () => {
    // Push on Sep 14 and Sep 21; nothing the week of Sep 28. Anchor = Sep 21 week.
    const w0 = wk('push', at(2026, 9, 14))
    const w1 = wk('push', at(2026, 9, 21))
    const sets = [st(w0, 1, 100, 1), st(w1, 1, 120, 1), st(w0, 2, 100, 1), st(w1, 2, 100, 1)]
    expect(weeklyStrengthChange(sets, [w0, w1], kindOf).push).toBeCloseTo(10, 10)
  })
  it('compares with the most recent earlier week that has data, not strictly the week before', () => {
    const w0 = wk('push', at(2026, 8, 3)) // long gap
    const w1 = wk('push', at(2026, 9, 28))
    const sets = [st(w0, 1, 100, 1), st(w1, 1, 150, 1), st(w0, 2, 200, 1), st(w1, 2, 200, 1)]
    expect(weeklyStrengthChange(sets, [w0, w1], kindOf).push).toBeCloseTo(25, 10)
  })
  it('follows workout type, not the exercise: the same lift in a Pull workout counts toward Pull', () => {
    const p0 = wk('pull', at(2026, 9, 21))
    const p1 = wk('pull', at(2026, 9, 28))
    const sets = [
      st(p0, 1, 100, 1),
      st(p1, 1, 110, 1),
      st(p0, 2, 100, 1),
      st(p1, 2, 110, 1),
      // Push-type workouts with a flat lift
      st(wkA, 1, 100, 1),
      st(wkB, 1, 100, 1),
      st(wkA, 2, 100, 1),
      st(wkB, 2, 100, 1),
    ]
    const r = weeklyStrengthChange(sets, [p0, p1, wkA, wkB], kindOf)
    expect(r.pull).toBeCloseTo(10, 10)
    expect(r.push).toBeCloseTo(0, 10)
  })
  it('each type has its own anchor week', () => {
    const l0 = wk('legs', at(2026, 9, 7))
    const l1 = wk('legs', at(2026, 9, 14))
    const sets = [st(l0, 1, 100, 1), st(l1, 1, 90, 1), st(l0, 2, 100, 1), st(l1, 2, 90, 1), st(wkA, 1, 100, 1), st(wkB, 1, 110, 1), st(wkA, 2, 100, 1), st(wkB, 2, 110, 1)]
    const r = weeklyStrengthChange(sets, [l0, l1, wkA, wkB], kindOf)
    expect(r.legs).toBeCloseTo(-10, 10)
    expect(r.push).toBeCloseTo(10, 10)
  })
  it('a decrease stays negative however small (the tile colors off the unrounded value)', () => {
    const sets = [st(wkA, 1, 1000, 1), st(wkB, 1, 999.9, 1), st(wkA, 2, 1000, 1), st(wkB, 2, 999.9, 1)]
    const v = weeklyStrengthChange(sets, [wkA, wkB], kindOf).push!
    expect(v).toBeLessThan(0)
    expect(Math.abs(v)).toBeLessThan(0.05)
  })
  it('empty history is all null', () => {
    expect(weeklyStrengthChange([], [], kindOf)).toEqual({ push: null, pull: null, legs: null, other: null })
  })
  it('ignores sets from workouts it does not know', () => {
    const orphan: SetEntry = { workoutExerciseId: 1, workoutId: 999, exerciseId: 1, completedAt: 1, weight: 100, reps: 1 }
    expect(weeklyStrengthChange([orphan], [], kindOf)).toEqual({ push: null, pull: null, legs: null, other: null })
  })
})

describe('chart drawing helpers', () => {
  it('smoothPath handles 0, 1 and 2 points', () => {
    expect(smoothPath([])).toBe('')
    expect(smoothPath([{ x: 1, y: 2 }])).toBe('M1,2')
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }]).startsWith('M0,0 C')).toBe(true)
  })
  it('scalePoints maps time to x and puts a higher value higher on screen', () => {
    const mk = (t: number, value: number) => ({ t, value, best: {} as SetEntry })
    const out = scalePoints([mk(0, 100), mk(10, 110), mk(20, 120)], 200, 100, 10, 10)
    expect(out[0].x).toBe(10)
    expect(out[2].x).toBe(190)
    expect(out[0].y).toBeGreaterThan(out[1].y)
    expect(out[1].y).toBeGreaterThan(out[2].y)
    for (const p of out) {
      expect(p.y).toBeGreaterThanOrEqual(10)
      expect(p.y).toBeLessThanOrEqual(90)
    }
  })
  it('scalePoints centers a single point and keeps a flat line off the edges', () => {
    const mk = (t: number, value: number) => ({ t, value, best: {} as SetEntry })
    expect(scalePoints([mk(5, 100)], 200, 100, 10, 10)[0].x).toBe(100)
    const flat = scalePoints([mk(0, 100), mk(10, 100)], 200, 100, 10, 10)
    expect(flat[0].y).toBe(flat[1].y)
    expect(scalePoints([], 200, 100, 10, 10)).toEqual([])
  })
})
