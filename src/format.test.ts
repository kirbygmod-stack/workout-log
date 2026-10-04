import { describe, expect, it } from 'vitest'
import { durationInput, fmtDuration, fmtNum, fmtSet, normName, parseDuration, parseNum } from './format'

describe('fmtDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(fmtDuration(0)).toBe('0:00')
    expect(fmtDuration(45)).toBe('0:45')
    expect(fmtDuration(90)).toBe('1:30')
    expect(fmtDuration(3723)).toBe('1:02:03')
  })
  it('rounds, clamps negatives, and shows a dash for missing or non-finite', () => {
    expect(fmtDuration(59.6)).toBe('1:00')
    expect(fmtDuration(-5)).toBe('0:00')
    expect(fmtDuration(undefined)).toBe('—')
    expect(fmtDuration(NaN)).toBe('—')
  })
})

describe('parseDuration', () => {
  it('parses m:ss and h:mm:ss', () => {
    expect(parseDuration('1:30')).toBe(90)
    expect(parseDuration('1:02:03')).toBe(3723)
  })
  it('a bare number is seconds for holds and minutes for cardio', () => {
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration('30', 'min')).toBe(1800)
  })
  it('rejects blanks, junk and negatives', () => {
    expect(parseDuration('')).toBeUndefined()
    expect(parseDuration('  ')).toBeUndefined()
    expect(parseDuration('abc')).toBeUndefined()
    expect(parseDuration('1:-5')).toBeUndefined()
  })
  it('round-trips through durationInput', () => {
    for (const sec of [0, 45, 90, 600, 3723]) expect(parseDuration(durationInput(sec))).toBe(sec)
    expect(durationInput(undefined)).toBe('')
  })
})

describe('parseNum / fmtNum', () => {
  it('parses numbers and rejects the rest', () => {
    expect(parseNum(' 52.5 ')).toBe(52.5)
    expect(parseNum('')).toBeUndefined()
    expect(parseNum('abc')).toBeUndefined()
    expect(parseNum('Infinity')).toBeUndefined()
  })
  it('fmtNum drops a trailing .0 and keeps one decimal', () => {
    expect(fmtNum(50)).toBe('50')
    expect(fmtNum(52.5)).toBe('52.5')
    expect(fmtNum(52.46)).toBe('52.5')
    expect(fmtNum(undefined)).toBe('')
  })
})

describe('fmtSet', () => {
  it('lifts, bodyweight and assisted', () => {
    expect(fmtSet({ kind: 'weight' }, { weight: 190, reps: 8 } as never)).toBe('190 × 8')
    expect(fmtSet({ kind: 'bodyweight' }, { reps: 12 } as never)).toBe('12 reps')
    expect(fmtSet({ kind: 'bodyweight' }, { weight: 25, reps: 8 } as never)).toBe('BW+25 × 8')
    expect(fmtSet({ kind: 'bodyweight' }, { assist: 50, reps: 8 } as never)).toBe('Assist 50 × 8')
  })
  it('cardio joins the fields it has', () => {
    expect(fmtSet({ kind: 'cardio', levelLabel: 'Incline %' }, { durationSec: 1800, speed: 3.5, level: 2, calories: 250 } as never)).toBe(
      '30:00 · 3.5 mph · Incline 2% · 250 cal',
    )
  })
})

describe('normName', () => {
  it('lowercases and strips everything but letters', () => {
    expect(normName('Push-up')).toBe('pushup')
    expect(normName('Back Squat')).toBe('backsquat')
    expect(normName('  O.H.P. ')).toBe('ohp')
    expect(normName('')).toBe('')
  })
})
