import Dexie, { type EntityTable } from 'dexie'

export type Section = 'push' | 'pull' | 'legs' | 'abs' | 'bodyweight' | 'cardio'
/** How sets for an exercise are logged. */
export type Kind = 'weight' | 'bodyweight' | 'timed' | 'cardio'
export type WorkoutType = 'push' | 'pull' | 'legs' | 'other'

export const SECTIONS: { id: Section; label: string }[] = [
  { id: 'push', label: 'Push' },
  { id: 'pull', label: 'Pull' },
  { id: 'legs', label: 'Legs' },
  { id: 'abs', label: 'Abs' },
  { id: 'bodyweight', label: 'Bodyweight' },
  { id: 'cardio', label: 'Cardio' },
]

export const WORKOUT_TYPES: { id: WorkoutType; label: string }[] = [
  { id: 'push', label: 'Push' },
  { id: 'pull', label: 'Pull' },
  { id: 'legs', label: 'Legs' },
  { id: 'other', label: 'Other' },
]

export const sectionLabel = (s: Section) => SECTIONS.find((x) => x.id === s)?.label ?? s
export const workoutTypeLabel = (t: WorkoutType) => WORKOUT_TYPES.find((x) => x.id === t)?.label ?? t

export interface Exercise {
  id?: number
  name: string
  section: Section
  kind: Kind
  /** Target rest between sets, seconds. */
  targetRestSec: number
  /** Cardio only: label for the incline/level field, e.g. "Incline %" or "Level". Empty = hide field. */
  levelLabel?: string
  /** Hidden from the picker, history kept. */
  archived?: boolean
  createdAt: number
}

export interface Workout {
  id?: number
  type: WorkoutType
  startedAt: number
  endedAt?: number
}

export interface WorkoutExercise {
  id?: number
  workoutId: number
  exerciseId: number
  order: number
  notes?: string
}

export interface SetEntry {
  id?: number
  workoutExerciseId: number
  workoutId: number
  exerciseId: number
  completedAt: number
  /** Rest taken before this set, seconds (measured automatically, editable). */
  restSec?: number
  /** Lifts: working weight. Bodyweight: added weight. lbs */
  weight?: number
  reps?: number
  /** Timed holds and cardio. */
  durationSec?: number
  /** Cardio: mph */
  speed?: number
  /** Cardio: incline % or resistance level */
  level?: number
  calories?: number
}

export interface Meta {
  key: string
  value: unknown
}

export const db = new Dexie('workout-log') as Dexie & {
  exercises: EntityTable<Exercise, 'id'>
  workouts: EntityTable<Workout, 'id'>
  workoutExercises: EntityTable<WorkoutExercise, 'id'>
  sets: EntityTable<SetEntry, 'id'>
  meta: EntityTable<Meta, 'key'>
}

db.version(1).stores({
  exercises: '++id, section, name',
  workouts: '++id, startedAt, type',
  workoutExercises: '++id, workoutId, exerciseId',
  sets: '++id, workoutExerciseId, workoutId, exerciseId',
  meta: 'key',
})

type Seed = [string, Section, Kind, number, string?]
const SEED: Seed[] = [
  ['Bench Press', 'push', 'weight', 150],
  ['Incline DB Press', 'push', 'weight', 120],
  ['Overhead Press', 'push', 'weight', 150],
  ['Lateral Raise', 'push', 'weight', 60],
  ['Cable Fly', 'push', 'weight', 60],
  ['Tricep Pushdown', 'push', 'weight', 60],
  ['Barbell Row', 'pull', 'weight', 150],
  ['Lat Pulldown', 'pull', 'weight', 120],
  ['Seated Cable Row', 'pull', 'weight', 120],
  ['Face Pull', 'pull', 'weight', 60],
  ['Barbell Curl', 'pull', 'weight', 60],
  ['Hammer Curl', 'pull', 'weight', 60],
  ['Back Squat', 'legs', 'weight', 180],
  ['Romanian Deadlift', 'legs', 'weight', 150],
  ['Leg Press', 'legs', 'weight', 120],
  ['Leg Curl', 'legs', 'weight', 90],
  ['Leg Extension', 'legs', 'weight', 90],
  ['Calf Raise', 'legs', 'weight', 60],
  ['Cable Crunch', 'abs', 'weight', 60],
  ['Hanging Leg Raise', 'abs', 'bodyweight', 60],
  ['Ab Wheel Rollout', 'abs', 'bodyweight', 60],
  ['Push-up', 'bodyweight', 'bodyweight', 60],
  ['Pull-up', 'bodyweight', 'bodyweight', 90],
  ['Plank', 'bodyweight', 'timed', 60],
  ['Bodyweight Squat', 'bodyweight', 'bodyweight', 60],
  ['Treadmill', 'cardio', 'cardio', 0, 'Incline %'],
  ['Stair Climber', 'cardio', 'cardio', 0, 'Level'],
  ['Outdoor Run', 'cardio', 'cardio', 0, ''],
]

db.on('populate', (tx) => {
  const now = Date.now()
  tx.table('exercises').bulkAdd(
    SEED.map(([name, section, kind, targetRestSec, levelLabel]) => ({
      name,
      section,
      kind,
      targetRestSec,
      ...(kind === 'cardio' ? { levelLabel: levelLabel ?? 'Incline / Level' } : {}),
      createdAt: now,
    })),
  )
})

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

/** Sets from the most recent *other* workout that included this exercise. */
export async function lastSessionFor(exerciseId: number, excludeWorkoutId?: number) {
  const wes = await db.workoutExercises.where('exerciseId').equals(exerciseId).reverse().sortBy('id')
  for (const we of wes) {
    if (we.workoutId === excludeWorkoutId) continue
    const sets = await db.sets.where('workoutExerciseId').equals(we.id!).sortBy('completedAt')
    if (sets.length === 0) continue
    const workout = await db.workouts.get(we.workoutId)
    if (!workout) continue
    return { workout, we, sets }
  }
  return null
}

export async function deleteWorkout(id: number) {
  await db.transaction('rw', db.workouts, db.workoutExercises, db.sets, async () => {
    await db.sets.where('workoutId').equals(id).delete()
    await db.workoutExercises.where('workoutId').equals(id).delete()
    await db.workouts.delete(id)
  })
}

export async function removeWorkoutExercise(weId: number) {
  await db.transaction('rw', db.workoutExercises, db.sets, async () => {
    await db.sets.where('workoutExerciseId').equals(weId).delete()
    await db.workoutExercises.delete(weId)
  })
}

export async function addExerciseToWorkout(workoutId: number, exerciseId: number) {
  const existing = await db.workoutExercises.where('workoutId').equals(workoutId).toArray()
  const order = existing.reduce((m, w) => Math.max(m, w.order), -1) + 1
  return db.workoutExercises.add({ workoutId, exerciseId, order })
}

export async function startWorkout(type: WorkoutType, copyFromWorkoutId?: number) {
  return db.transaction('rw', db.workouts, db.workoutExercises, db.exercises, async () => {
    const id = await db.workouts.add({ type, startedAt: Date.now() })
    if (copyFromWorkoutId) {
      const prev = await db.workoutExercises.where('workoutId').equals(copyFromWorkoutId).sortBy('order')
      let order = 0
      for (const p of prev) {
        const ex = await db.exercises.get(p.exerciseId)
        if (!ex || ex.archived) continue
        await db.workoutExercises.add({ workoutId: id!, exerciseId: p.exerciseId, order: order++ })
      }
    }
    return id
  })
}

/** Ends the workout and drops exercises that never got a set. */
export async function finishWorkout(id: number) {
  await db.transaction('rw', db.workouts, db.workoutExercises, db.sets, async () => {
    const wes = await db.workoutExercises.where('workoutId').equals(id).toArray()
    for (const we of wes) {
      const n = await db.sets.where('workoutExerciseId').equals(we.id!).count()
      if (n === 0 && !we.notes?.trim()) await db.workoutExercises.delete(we.id!)
    }
    await db.workouts.update(id, { endedAt: Date.now() })
  })
}

/** Latest set logged in a workout (any exercise) — the rest timer runs from this. */
export async function lastSetInWorkout(workoutId: number) {
  const sets = await db.sets.where('workoutId').equals(workoutId).sortBy('completedAt')
  return sets.at(-1)
}

/** Rest longer than this is treated as "not resting" (e.g. switched gyms / walked away) and not recorded. */
export const MAX_RECORDED_REST_SEC = 20 * 60

// ---------- Backup ----------

export interface BackupFile {
  app: 'workout-log'
  version: 1
  exportedAt: string
  exercises: Exercise[]
  workouts: Workout[]
  workoutExercises: WorkoutExercise[]
  sets: SetEntry[]
}

export async function exportData(): Promise<BackupFile> {
  return {
    app: 'workout-log',
    version: 1,
    exportedAt: new Date().toISOString(),
    exercises: await db.exercises.toArray(),
    workouts: await db.workouts.toArray(),
    workoutExercises: await db.workoutExercises.toArray(),
    sets: await db.sets.toArray(),
  }
}

export async function importData(data: BackupFile) {
  if (data?.app !== 'workout-log' || !Array.isArray(data.exercises) || !Array.isArray(data.sets)) {
    throw new Error("That file isn't a Workout Log backup.")
  }
  await db.transaction('rw', [db.exercises, db.workouts, db.workoutExercises, db.sets], async () => {
    await Promise.all([db.exercises.clear(), db.workouts.clear(), db.workoutExercises.clear(), db.sets.clear()])
    await db.exercises.bulkAdd(data.exercises)
    await db.workouts.bulkAdd(data.workouts)
    await db.workoutExercises.bulkAdd(data.workoutExercises)
    await db.sets.bulkAdd(data.sets)
  })
}
