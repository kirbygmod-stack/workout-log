import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addLaterStarters,
  BACKUP_VERSION,
  type BackupFile,
  db,
  deleteWeight,
  exportData,
  getTargetRate,
  getWeightGoal,
  importData,
  isDefaultAssistable,
  saveWeight,
  setTargetRate,
  setWeightGoal,
} from './db'

async function wipe() {
  await Promise.all([db.exercises.clear(), db.workouts.clear(), db.workoutExercises.clear(), db.sets.clear(), db.weights.clear(), db.meta.clear()])
}

const exercise = (id: number, name: string, kind: 'weight' | 'bodyweight' | 'timed' = 'weight', extra = {}) => ({
  id,
  name,
  section: kind === 'weight' ? ('push' as const) : ('bodyweight' as const),
  kind,
  targetRestSec: 90,
  createdAt: 1,
  ...extra,
})

/** A small but complete backup in the current format. */
function backup(over: Partial<BackupFile> = {}): BackupFile {
  return {
    app: 'workout-log',
    version: BACKUP_VERSION,
    exportedAt: '2026-10-04T00:00:00.000Z',
    exercises: [exercise(1, 'Bench Press'), exercise(2, 'Pull-up', 'bodyweight')],
    workouts: [{ id: 1, type: 'push', startedAt: 1000, endedAt: 5000 }],
    workoutExercises: [{ id: 1, workoutId: 1, exerciseId: 1, order: 0 }],
    sets: [{ id: 1, workoutExerciseId: 1, workoutId: 1, exerciseId: 1, completedAt: 2000, weight: 135, reps: 8 }],
    weights: [
      { id: 1, date: '2026-10-01', weight: 194.2, createdAt: 1, updatedAt: 1 },
      { id: 2, date: '2026-10-02', weight: 193.8, createdAt: 2, updatedAt: 2 },
    ],
    weightGoal: { weight: 185, dir: 'down' },
    weightTargetRate: 1,
    ...over,
  }
}

const counts = async () => ({
  exercises: await db.exercises.count(),
  workouts: await db.workouts.count(),
  workoutExercises: await db.workoutExercises.count(),
  sets: await db.sets.count(),
  weights: await db.weights.count(),
})

describe('fresh install', () => {
  it('seeds the starter library once, with exactly one Deadlift and the default assistable lifts', async () => {
    await db.open()
    const all = await db.exercises.toArray()
    expect(all).toHaveLength(30)
    expect(all.filter((e) => e.name === 'Deadlift')).toHaveLength(1)
    const assistable = all.filter((e) => e.assistable).map((e) => e.name).sort()
    expect(assistable).toEqual(['Dips', 'Pull-up', 'Push-up'])
    expect(await db.weights.count()).toBe(0)
  })
})

describe('isDefaultAssistable', () => {
  it('matches pull-ups, dips and push-ups regardless of case and punctuation, bodyweight only', () => {
    for (const name of ['Pull-up', 'pull ups', 'PULLUPS', 'Dips', 'Dip', 'Push-up', 'push ups']) {
      expect(isDefaultAssistable({ name, kind: 'bodyweight' })).toBe(true)
    }
    expect(isDefaultAssistable({ name: 'Pull-up', kind: 'weight' })).toBe(false)
    for (const name of ['Plank', 'Hanging Leg Raise', 'Ab Wheel Rollout', 'Bodyweight Squat']) {
      expect(isDefaultAssistable({ name, kind: 'bodyweight' })).toBe(false)
    }
  })
})

describe('addLaterStarters', () => {
  beforeEach(wipe)
  it('adds Deadlift to a library without one, exactly once', async () => {
    await db.exercises.add(exercise(1, 'Bench Press') as never)
    await addLaterStarters()
    await addLaterStarters()
    const names = (await db.exercises.toArray()).map((e) => e.name)
    expect(names.filter((n) => n === 'Deadlift')).toHaveLength(1)
    expect(names).toContain('Bench Press')
  })
  it('skips when an exercise by that name already exists (any case or punctuation)', async () => {
    await db.exercises.add(exercise(1, 'dead-lift') as never)
    await addLaterStarters()
    expect(await db.exercises.count()).toBe(1)
  })
  it('does not bring it back after the user deletes it', async () => {
    await addLaterStarters()
    const dl = await db.exercises.where('name').equals('Deadlift').first()
    await db.exercises.delete(dl!.id!)
    await addLaterStarters()
    expect(await db.exercises.where('name').equals('Deadlift').count()).toBe(0)
  })
})

describe('weigh-ins', () => {
  beforeEach(wipe)
  it('saves one entry per day: saving the same date replaces it', async () => {
    await saveWeight('2026-10-01', 194.2)
    await saveWeight('2026-10-01', 193.0)
    const all = await db.weights.toArray()
    expect(all).toHaveLength(1)
    expect(all[0].weight).toBe(193.0)
    expect(all[0].updatedAt).toBeGreaterThanOrEqual(all[0].createdAt)
  })
  it('editing an entry and changing its date moves it, removing the old date', async () => {
    await saveWeight('2026-10-01', 194.2)
    await saveWeight('2026-10-03', 194.2, '2026-10-01')
    expect((await db.weights.toArray()).map((w) => w.date)).toEqual(['2026-10-03'])
  })
  it('moving onto a day that has an entry replaces that entry', async () => {
    await saveWeight('2026-10-01', 194.2)
    await saveWeight('2026-10-03', 190.0)
    await saveWeight('2026-10-03', 194.2, '2026-10-01')
    const all = await db.weights.toArray()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ date: '2026-10-03', weight: 194.2 })
  })
  it('deletes by date', async () => {
    await saveWeight('2026-10-01', 194.2)
    await saveWeight('2026-10-02', 194.0)
    await deleteWeight('2026-10-01')
    expect((await db.weights.toArray()).map((w) => w.date)).toEqual(['2026-10-02'])
  })
  it('the database itself refuses a duplicate date', async () => {
    await db.weights.add({ date: '2026-10-01', weight: 190, createdAt: 1, updatedAt: 1 })
    await expect(db.weights.add({ date: '2026-10-01', weight: 191, createdAt: 1, updatedAt: 1 })).rejects.toThrow()
  })
})

describe('export', () => {
  beforeEach(wipe)
  it('writes the current format version with every part of the data', async () => {
    await importData(backup())
    const out = await exportData()
    expect(out.app).toBe('workout-log')
    expect(out.version).toBe(BACKUP_VERSION)
    expect(out.version).toBe(4)
    expect(out.weightGoal).toEqual({ weight: 185, dir: 'down' })
    expect(out.weightTargetRate).toBe(1)
    expect(out.sets).toHaveLength(1)
  })
  it('weights come out sorted by date; goal and rate are null when unset', async () => {
    await saveWeight('2026-10-03', 190)
    await saveWeight('2026-10-01', 192)
    await saveWeight('2026-10-02', 191)
    const out = await exportData()
    expect(out.weights!.map((w) => w.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(out.weightGoal).toBeNull()
    expect(out.weightTargetRate).toBeNull()
  })
  it('export → import → export is identical (apart from the timestamp)', async () => {
    await importData(backup())
    const a = await exportData()
    await importData(JSON.parse(JSON.stringify(a)))
    const b = await exportData()
    expect({ ...b, exportedAt: '' }).toEqual({ ...a, exportedAt: '' })
  })
})

describe('importData: accepting files', () => {
  beforeEach(wipe)
  it('restores a current (v4) file completely', async () => {
    await importData(backup())
    expect(await counts()).toEqual({ exercises: 2, workouts: 1, workoutExercises: 1, sets: 1, weights: 2 })
    expect(await getWeightGoal()).toEqual({ weight: 185, dir: 'down' })
    expect(await getTargetRate()).toBe(1)
  })
  it('replaces everything that was there', async () => {
    await db.exercises.add(exercise(50, 'Leftover') as never)
    await saveWeight('2020-01-01', 250)
    await setWeightGoal({ weight: 100 })
    await setTargetRate(2)
    await importData(backup({ weightGoal: null, weightTargetRate: null }))
    expect((await db.exercises.toArray()).map((e) => e.name).sort()).toEqual(['Bench Press', 'Pull-up'])
    expect((await db.weights.toArray()).map((w) => w.date)).toEqual(['2026-10-01', '2026-10-02'])
    expect(await getWeightGoal()).toBeUndefined()
    expect(await getTargetRate()).toBeUndefined()
  })
  it('v3 file: weights and goal restore, any target rate is cleared', async () => {
    await setTargetRate(2)
    const { weightTargetRate: _drop, ...rest } = backup({ version: 3 })
    await importData(rest as BackupFile)
    expect(await db.weights.count()).toBe(2)
    expect(await getWeightGoal()).toEqual({ weight: 185, dir: 'down' })
    expect(await getTargetRate()).toBeUndefined()
  })
  it('v3 file that contains a target rate ignores it', async () => {
    await importData(backup({ version: 3, weightTargetRate: 1.5 }))
    expect(await getTargetRate()).toBeUndefined()
  })
  it('v2 file: no weights, no goal, no rate', async () => {
    await saveWeight('2026-01-01', 200)
    await setWeightGoal({ weight: 150 })
    await importData(backup({ version: 2, weights: undefined, weightGoal: undefined, weightTargetRate: undefined }))
    expect(await db.weights.count()).toBe(0)
    expect(await getWeightGoal()).toBeUndefined()
    // v2 files carry assistable flags already: left alone
    expect(await db.exercises.count()).toBe(2)
  })
  it('v2 file ignores weights even if present', async () => {
    await importData(backup({ version: 2 }))
    expect(await db.weights.count()).toBe(0)
  })
  it('v1 file: default assistable lifts get flagged, nothing else changes', async () => {
    const v1 = backup({
      version: 1,
      weights: undefined,
      weightGoal: undefined,
      weightTargetRate: undefined,
      exercises: [exercise(1, 'Bench Press'), exercise(2, 'Pull-up', 'bodyweight'), exercise(3, 'Dips', 'bodyweight'), exercise(4, 'Plank', 'timed'), exercise(5, 'Push-ups', 'bodyweight')],
    })
    await importData(v1)
    const byName = Object.fromEntries((await db.exercises.toArray()).map((e) => [e.name, e]))
    expect(byName['Pull-up'].assistable).toBe(true)
    expect(byName['Dips'].assistable).toBe(true)
    expect(byName['Push-ups'].assistable).toBe(true)
    expect(byName['Bench Press'].assistable).toBeUndefined()
    expect(byName['Plank'].assistable).toBeUndefined()
    expect(byName['Pull-up']).toMatchObject({ name: 'Pull-up', kind: 'bodyweight', targetRestSec: 90 })
  })
  it('v2+ files keep exercise flags exactly as written', async () => {
    await importData(backup({ exercises: [exercise(1, 'Pull-up', 'bodyweight', { assistable: false })] }))
    expect((await db.exercises.toArray())[0].assistable).toBe(false)
  })
  it('a goal without a direction restores as written', async () => {
    await importData(backup({ weightGoal: { weight: 190 } }))
    expect(await getWeightGoal()).toEqual({ weight: 190 })
  })
  it('accepts target rates at the limits and drops ones outside them', async () => {
    for (const [rate, expected] of [[0.25, 0.25], [3, 3], [0.1, undefined], [3.5, undefined], [0, undefined], [-1, undefined]] as const) {
      await importData(backup({ weightTargetRate: rate }))
      expect(await getTargetRate(), `rate ${rate}`).toBe(expected)
    }
    await importData(backup({ weightTargetRate: null }))
    expect(await getTargetRate()).toBeUndefined()
  })
  it('a goal that is not a number is dropped', async () => {
    await importData(backup({ weightGoal: { weight: 'x' } as never }))
    expect(await getWeightGoal()).toBeUndefined()
  })
})

describe('importData: rejecting files', () => {
  beforeEach(async () => {
    await wipe()
    await importData(backup())
  })
  const before = async () => ({ counts: await counts(), goal: await getWeightGoal(), rate: await getTargetRate() })

  async function rejects(file: unknown, message: RegExp) {
    const snapshot = await before()
    await expect(importData(file as BackupFile)).rejects.toThrow(message)
    // a rejected file changes nothing
    expect(await before()).toEqual(snapshot)
  }

  it('not a backup', async () => {
    await rejects(null, /isn't a Workout Log backup/)
    await rejects({}, /isn't a Workout Log backup/)
    await rejects({ ...backup(), app: 'something-else' }, /isn't a Workout Log backup/)
    await rejects({ ...backup(), exercises: undefined }, /isn't a Workout Log backup/)
    await rejects({ ...backup(), sets: 'nope' }, /isn't a Workout Log backup/)
  })
  it('missing, zero, fractional or non-numeric version', async () => {
    for (const version of [undefined, 0, -1, 1.5, '3', null, NaN]) {
      await rejects({ ...backup(), version }, /no valid format version/)
    }
  })
  it('a version newer than the app', async () => {
    await rejects(backup({ version: BACKUP_VERSION + 1 }), new RegExp(`format v${BACKUP_VERSION + 1}`))
    await rejects(backup({ version: 99 }), /Update the app first/)
  })
  it('a weigh-in it cannot read', async () => {
    const w = (over: object) => ({ id: 9, date: '2026-10-03', weight: 190, createdAt: 1, updatedAt: 1, ...over })
    for (const bad of [w({ date: '10/03/2026' }), w({ date: '2026-1-3' }), w({ date: undefined }), w({ weight: '190' }), w({ weight: NaN }), w({ weight: Infinity }), null]) {
      await rejects(backup({ weights: [w({}), bad as never] }), /weigh-in it can’t read/)
    }
  })
})
