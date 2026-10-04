// Schema upgrade rehearsal: a database created by the v2 app (assisted bodyweight, no weights), opened by the current code.
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeAll, describe, expect, it } from 'vitest'

const exercises = [
  { id: 1, name: 'Bench Press', section: 'push', kind: 'weight', targetRestSec: 150, createdAt: 1 },
  { id: 2, name: 'Pull-up', section: 'bodyweight', kind: 'bodyweight', targetRestSec: 90, assistable: true, createdAt: 1 },
  { id: 3, name: 'Dips', section: 'bodyweight', kind: 'bodyweight', targetRestSec: 90, assistable: false, createdAt: 1 },
]
const workouts = [{ id: 1, type: 'pull', startedAt: 1000, endedAt: 9000 }]
const workoutExercises = [{ id: 1, workoutId: 1, exerciseId: 2, order: 0 }]
const sets = [
  { id: 1, workoutExerciseId: 1, workoutId: 1, exerciseId: 2, completedAt: 2000, assist: 50, reps: 8 },
  { id: 2, workoutExerciseId: 1, workoutId: 1, exerciseId: 2, completedAt: 3000, restSec: 120, assist: 45, reps: 8 },
]
const meta = [
  { key: 'lastBackupAt', value: 123456 },
  { key: 'starter:deadlift', value: 5 },
  { key: 'restStop', value: { setId: 2, at: 4000 } },
]

beforeAll(async () => {
  const old = new Dexie('workout-log')
  const stores = {
    exercises: '++id, section, name',
    workouts: '++id, startedAt, type',
    workoutExercises: '++id, workoutId, exerciseId',
    sets: '++id, workoutExerciseId, workoutId, exerciseId',
    meta: 'key',
  }
  old.version(1).stores(stores)
  old.version(2).stores(stores)
  await old.table('exercises').bulkAdd(exercises)
  await old.table('workouts').bulkAdd(workouts)
  await old.table('workoutExercises').bulkAdd(workoutExercises)
  await old.table('sets').bulkAdd(sets)
  await old.table('meta').bulkAdd(meta)
  old.close()
})

describe('v2 database → current schema', () => {
  it('every record and meta entry is identical afterwards (including a deliberate assistable: false)', async () => {
    const { db } = await import('./db')
    await db.open()
    expect(db.verno).toBe(3)
    expect(await db.exercises.toArray()).toEqual(exercises)
    expect(await db.workouts.toArray()).toEqual(workouts)
    expect(await db.workoutExercises.toArray()).toEqual(workoutExercises)
    expect(await db.sets.toArray()).toEqual(sets)
    expect(await db.meta.toArray()).toEqual([...meta].sort((a, b) => a.key.localeCompare(b.key))) // meta reads back in key order
  })
  it('adds an empty weights store', async () => {
    const { db } = await import('./db')
    expect(await db.weights.count()).toBe(0)
  })
  it('a backup of the upgraded data re-imports identically', async () => {
    const { db, exportData, importData } = await import('./db')
    const a = await exportData()
    await importData(JSON.parse(JSON.stringify(a)))
    const b = await exportData()
    expect({ ...b, exportedAt: '' }).toEqual({ ...a, exportedAt: '' })
    expect(await db.sets.count()).toBe(2)
  })
})
