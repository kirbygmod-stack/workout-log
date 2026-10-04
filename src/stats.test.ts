import { describe, expect, it } from 'vitest'
import type { SetEntry } from './db'
import { bestE1rm, e1rm, fmtLbs, fmtSession, fmtTile, setDelta, setVolume, volume } from './stats'

const set = (o: Partial<SetEntry>): SetEntry => ({ workoutExerciseId: 1, workoutId: 1, exerciseId: 1, completedAt: 0, ...o })

describe('e1rm (Epley)', () => {
  it('is weight × (1 + reps/30)', () => {
    expect(e1rm(150, 6)).toBeCloseTo(180, 10)
    expect(e1rm(100, 10)).toBeCloseTo(133.333, 3)
  })
  it('takes a single as-is', () => {
    expect(e1rm(225, 1)).toBe(225)
  })
  it('is 0 when weight or reps are missing or zero', () => {
    expect(e1rm(undefined, 5)).toBe(0)
    expect(e1rm(100, undefined)).toBe(0)
    expect(e1rm(0, 5)).toBe(0)
    expect(e1rm(100, 0)).toBe(0)
  })
  it('bestE1rm picks the highest set, 0 for none', () => {
    expect(bestE1rm([set({ weight: 100, reps: 5 }), set({ weight: 120, reps: 3 }), set({ weight: 50, reps: 20 })])).toBeCloseTo(120 * 1.1, 10)
    expect(bestE1rm([])).toBe(0)
    expect(bestE1rm([set({ reps: 10 })])).toBe(0)
  })
})

describe('volume', () => {
  const kinds = { 1: 'weight', 2: 'bodyweight', 3: 'cardio' } as const
  const kindOf = (id: number) => kinds[id as 1 | 2 | 3]
  it('sums weight × reps for weighted lifts only', () => {
    const sets = [
      set({ exerciseId: 1, weight: 100, reps: 5 }),
      set({ exerciseId: 1, weight: 100, reps: 4 }),
      set({ exerciseId: 2, weight: 25, reps: 8 }),
      set({ exerciseId: 3, durationSec: 600 }),
    ]
    expect(volume(sets, kindOf)).toBe(900)
  })
  it('treats missing numbers as 0 and unknown exercises as not weighted', () => {
    expect(volume([set({ exerciseId: 1, reps: 5 })], kindOf)).toBe(0)
    expect(volume([set({ exerciseId: 99, weight: 100, reps: 5 })], kindOf)).toBe(0)
  })
})

describe('setVolume', () => {
  const kindOf = (id: number) => (id === 1 ? 'weight' : id === 2 ? 'bodyweight' : undefined)
  it('is weight × reps for weighted lifts, 0 for everything else', () => {
    expect(setVolume(set({ exerciseId: 1, weight: 100, reps: 5 }), kindOf)).toBe(500)
    expect(setVolume(set({ exerciseId: 1, weight: 100 }), kindOf)).toBe(0)
    expect(setVolume(set({ exerciseId: 2, weight: 25, reps: 8 }), kindOf)).toBe(0)
    expect(setVolume(set({ exerciseId: 99, weight: 100, reps: 5 }), kindOf)).toBe(0)
  })
})

describe('fmtTile / fmtSession', () => {
  it('weighted', () => expect(fmtTile('weight', set({ weight: 190, reps: 8 }))).toBe('190×8'))
  it('keeps one decimal for half plates', () => expect(fmtTile('weight', set({ weight: 52.5, reps: 8 }))).toBe('52.5×8'))
  it('assisted, added and plain bodyweight', () => {
    expect(fmtTile('bodyweight', set({ assist: 50, reps: 8 }), true)).toBe('A50×8')
    expect(fmtTile('bodyweight', set({ weight: 25, reps: 8 }), true)).toBe('+25×8')
    expect(fmtTile('bodyweight', set({ reps: 8 }), true)).toBe('BW×8')
    expect(fmtTile('bodyweight', set({ reps: 12 }), false)).toBe('12')
  })
  it('timed', () => expect(fmtTile('timed', set({ durationSec: 45 }))).toBe('0:45'))
  it('collapses identical sets', () => {
    const s = set({ weight: 65, reps: 10 })
    expect(fmtSession('weight', [s, s, s])).toBe('65×10 ×3')
  })
  it('lists differing sets', () => {
    expect(fmtSession('weight', [set({ weight: 185, reps: 8 }), set({ weight: 185, reps: 8 }), set({ weight: 185, reps: 7 })])).toBe('185×8 · 185×8 · 185×7')
  })
  it('a single set is not collapsed', () => expect(fmtSession('weight', [set({ weight: 65, reps: 10 })])).toBe('65×10'))
})

describe('setDelta', () => {
  it('is null with no previous set', () => expect(setDelta('weight', set({ weight: 100, reps: 5 }), undefined)).toBeNull())
  it('weight up and down', () => {
    expect(setDelta('weight', set({ weight: 105, reps: 5 }), set({ weight: 100, reps: 5 }))).toEqual({ text: '▲5 lb', up: true })
    expect(setDelta('weight', set({ weight: 95, reps: 5 }), set({ weight: 100, reps: 5 }))).toEqual({ text: '▼5 lb', up: false })
  })
  it('falls back to reps when the load is equal, singular for 1', () => {
    expect(setDelta('weight', set({ weight: 100, reps: 6 }), set({ weight: 100, reps: 5 }))).toEqual({ text: '▲1 rep', up: true })
    expect(setDelta('weight', set({ weight: 100, reps: 3 }), set({ weight: 100, reps: 5 }))).toEqual({ text: '▼2 reps', up: false })
  })
  it('is null when nothing changed', () => {
    expect(setDelta('weight', set({ weight: 100, reps: 5 }), set({ weight: 100, reps: 5 }))).toBeNull()
  })
  it('less assist is up: assist 50 → 40 = ▲10 lb', () => {
    expect(setDelta('bodyweight', set({ assist: 40, reps: 8 }), set({ assist: 50, reps: 8 }))).toEqual({ text: '▲10 lb', up: true })
  })
  it('assist 10 → bodyweight = ▲10 lb', () => {
    expect(setDelta('bodyweight', set({ reps: 8 }), set({ assist: 10, reps: 8 }))).toEqual({ text: '▲10 lb', up: true })
  })
  it('bodyweight → added weight is up, more assist is down', () => {
    expect(setDelta('bodyweight', set({ weight: 10, reps: 8 }), set({ reps: 8 }))).toEqual({ text: '▲10 lb', up: true })
    expect(setDelta('bodyweight', set({ assist: 60, reps: 8 }), set({ assist: 50, reps: 8 }))).toEqual({ text: '▼10 lb', up: false })
  })
  it('equal assist falls back to reps', () => {
    expect(setDelta('bodyweight', set({ assist: 50, reps: 9 }), set({ assist: 50, reps: 8 }))).toEqual({ text: '▲1 rep', up: true })
  })
  it('timed holds compare seconds', () => {
    expect(setDelta('timed', set({ durationSec: 50 }), set({ durationSec: 45 }))).toEqual({ text: '▲5s', up: true })
  })
  it('cardio has no delta', () => expect(setDelta('cardio', set({ durationSec: 600 }), set({ durationSec: 500 }))).toBeNull())
})

it('fmtLbs rounds and groups thousands', () => {
  expect(fmtLbs(12345.6)).toBe('12,346')
  expect(fmtLbs(0)).toBe('0')
})
