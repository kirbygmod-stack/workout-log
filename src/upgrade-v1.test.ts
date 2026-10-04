// Schema upgrade rehearsal: a database created by the v1 app, opened by the current code.
// Kept in its own file so the old database exists before ./db is first imported.
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeAll, describe, expect, it } from 'vitest'

const exercises = [
  { id: 1, name: 'Bench Press', section: 'push', kind: 'weight', targetRestSec: 150, createdAt: 1 },
  { id: 2, name: 'Pull-up', section: 'bodyweight', kind: 'bodyweight', targetRestSec: 90, createdAt: 1 },
  { id: 3, name: 'Dips', section: 'bodyweight', kind: 'bodyweight', targetRestSec: 90, createdAt: 1 },
  { id: 4, name: 'Push-up', section: 'bodyweight', kind: 'bodyweight', targetRestSec: 60, createdAt: 1 },
  { id: 5, name: 'Plank', section: 'bodyweight', kind: 'timed', targetRestSec: 60, createdAt: 1 },
  { id: 6, name: 'Ab Wheel Rollout', section: 'abs', kind: 'bodyweight', targetRestSec: 60, createdAt: 1 },
  { id: 7, name: 'Treadmill', section: 'cardio', kind: 'cardio', targetRestSec: 0, levelLabel: 'Incline %', createdAt: 1 },
]
const workouts = [
  { id: 1, type: 'push', startedAt: 1000, endedAt: 9000 },
  { id: 2, type: 'pull', startedAt: 20000 },
]
const workoutExercises = [
  { id: 1, workoutId: 1, exerciseId: 1, order: 0, notes: 'felt strong' },
  { id: 2, workoutId: 2, exerciseId: 2, order: 0 },
]
const sets = [
  { id: 1, workoutExerciseId: 1, workoutId: 1, exerciseId: 1, completedAt: 2000, weight: 135, reps: 8 },
  { id: 2, workoutExerciseId: 1, workoutId: 1, exerciseId: 1, completedAt: 3000, restSec: 95, weight: 135, reps: 7 },
  { id: 3, workoutExerciseId: 2, workoutId: 2, exerciseId: 2, completedAt: 21000, reps: 6 },
]
const meta = [{ key: 'lastBackupAt', value: 123456 }]

beforeAll(async () => {
  const old = new Dexie('workout-log')
  old.version(1).stores({
    exercises: '++id, section, name',
    workouts: '++id, startedAt, type',
    workoutExercises: '++id, workoutId, exerciseId',
    sets: '++id, workoutExerciseId, workoutId, exerciseId',
    meta: 'key',
  })
  await old.table('exercises').bulkAdd(exercises)
  await old.table('workouts').bulkAdd(workouts)
  await old.table('workoutExercises').bulkAdd(workoutExercises)
  await old.table('sets').bulkAdd(sets)
  await old.table('meta').bulkAdd(meta)
  old.close()
})

describe('v1 database → current schema', () => {
  it('upgrades in place: every record survives, only the assistable flag is added', async () => {
    const { db } = await import('./db')
    await db.open()
    expect(db.verno).toBe(3)

    const flagged = new Set(['Pull-up', 'Dips', 'Push-up'])
    expect(await db.exercises.toArray()).toEqual(exercises.map((e) => (flagged.has(e.name) ? { ...e, assistable: true } : e)))
    expect(await db.workouts.toArray()).toEqual(workouts)
    expect(await db.workoutExercises.toArray()).toEqual(workoutExercises)
    expect(await db.sets.toArray()).toEqual(sets)
    expect(await db.meta.toArray()).toEqual(meta)
  })
  it('adds an empty weights store and does not re-run the starter seed', async () => {
    const { db } = await import('./db')
    expect(await db.weights.count()).toBe(0)
    expect(await db.exercises.count()).toBe(exercises.length)
  })
  it('the new store enforces one weigh-in per day', async () => {
    const { db } = await import('./db')
    await db.weights.add({ date: '2026-10-01', weight: 190, createdAt: 1, updatedAt: 1 })
    await expect(db.weights.add({ date: '2026-10-01', weight: 191, createdAt: 1, updatedAt: 1 })).rejects.toThrow()
  })
})
