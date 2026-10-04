import Dexie, { type EntityTable } from 'dexie'
import { normName } from './format'

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
  /** Bodyweight only: sets can be logged as machine/band assisted (schema v2). */
  assistable?: boolean
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
  /** Bodyweight (assistable exercises): assistance, lbs > 0. Less is progress. When set, `weight` is absent. */
  assist?: number
  reps?: number
  /** Timed holds and cardio. */
  durationSec?: number
  /** Cardio: mph */
  speed?: number
  /** Cardio: incline % or resistance level */
  level?: number
  calories?: number
}

/** One weigh-in per local day (schema v3). */
export interface WeightEntry {
  id?: number
  /** Local day, YYYY-MM-DD. Unique. */
  date: string
  /** lbs, one decimal. */
  weight: number
  createdAt: number
  updatedAt: number
}

/** Weight goal, kept in meta. `dir` is fixed when the goal is set so "Reached" can tell which side is past it. */
export interface WeightGoal {
  weight: number
  dir?: 'down' | 'up'
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
  weights: EntityTable<WeightEntry, 'id'>
}

db.version(1).stores({
  exercises: '++id, section, name',
  workouts: '++id, startedAt, type',
  workoutExercises: '++id, workoutId, exerciseId',
  sets: '++id, workoutExerciseId, workoutId, exerciseId',
  meta: 'key',
})

// v2: exercises gain `assistable`, sets gain `assist`. Neither is indexed, so the stores are unchanged;
// the upgrade turns assist on for the lifts that use it.
db.version(2)
  .stores({
    exercises: '++id, section, name',
    workouts: '++id, startedAt, type',
    workoutExercises: '++id, workoutId, exerciseId',
    sets: '++id, workoutExerciseId, workoutId, exerciseId',
    meta: 'key',
  })
  .upgrade((tx) =>
    tx
      .table('exercises')
      .toCollection()
      .modify((e: Exercise) => {
        if (isDefaultAssistable(e)) e.assistable = true
      }),
  )

// v3: new `weights` store, one entry per day (unique date). Existing stores and records unchanged.
db.version(3).stores({
  exercises: '++id, section, name',
  workouts: '++id, startedAt, type',
  workoutExercises: '++id, workoutId, exerciseId',
  sets: '++id, workoutExerciseId, workoutId, exerciseId',
  meta: 'key',
  weights: '++id, &date',
})

/** Exercises that get the Assist option by default: pull-ups, dips, push-ups. */
const ASSISTABLE_NAMES = new Set(['pullup', 'pullups', 'dip', 'dips', 'pushup', 'pushups'])
export function isDefaultAssistable(e: Pick<Exercise, 'name' | 'kind'>) {
  return e.kind === 'bodyweight' && ASSISTABLE_NAMES.has(normName(e.name))
}

/** Max assist the input accepts, lbs. */
export const MAX_ASSIST_LB = 300

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
  ['Deadlift', 'legs', 'weight', 180],
  ['Leg Press', 'legs', 'weight', 120],
  ['Leg Curl', 'legs', 'weight', 90],
  ['Leg Extension', 'legs', 'weight', 90],
  ['Calf Raise', 'legs', 'weight', 60],
  ['Cable Crunch', 'abs', 'weight', 60],
  ['Hanging Leg Raise', 'abs', 'bodyweight', 60],
  ['Ab Wheel Rollout', 'abs', 'bodyweight', 60],
  ['Push-up', 'bodyweight', 'bodyweight', 60],
  ['Pull-up', 'bodyweight', 'bodyweight', 90],
  ['Dips', 'bodyweight', 'bodyweight', 90],
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
      ...(isDefaultAssistable({ name, kind }) ? { assistable: true } : {}),
      ...(kind === 'cardio' ? { levelLabel: levelLabel ?? 'Incline / Level' } : {}),
      createdAt: now,
    })),
  )
})

/**
 * Starter exercises added after launch. Existing libraries get each one once (tracked in meta),
 * skipped if an exercise with that name already exists. No schema change: it's one ordinary record.
 */
const LATER_STARTERS: { key: string; exercise: Omit<Exercise, 'id' | 'createdAt'> }[] = [
  { key: 'starter:deadlift', exercise: { name: 'Deadlift', section: 'legs', kind: 'weight', targetRestSec: 180 } },
]

export async function addLaterStarters() {
  await db.transaction('rw', db.exercises, db.meta, async () => {
    for (const { key, exercise } of LATER_STARTERS) {
      if (await db.meta.get(key)) continue
      const names = new Set((await db.exercises.toArray()).map((e) => normName(e.name)))
      if (!names.has(normName(exercise.name))) await db.exercises.add({ ...exercise, createdAt: Date.now() })
      await db.meta.put({ key, value: Date.now() })
    }
  })
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

/**
 * Rest timer Stop: freezes the rest that follows `setId` at time `at`. The next logged set saves
 * that frozen rest instead of the time until logging, then the entry is cleared. Kept in meta
 * (not exported in backups) so it survives the app being closed mid-workout.
 */
export interface RestStop {
  setId: number
  at: number
}
const REST_STOP_KEY = 'restStop'
export const getRestStop = () => getMeta<RestStop>(REST_STOP_KEY)
/** Stops the rest after the latest set in the workout, looked up at tap time (never a stale render). */
export async function stopRest(workoutId: number) {
  const at = Date.now()
  const last = await lastSetInWorkout(workoutId)
  if (last) await setMeta(REST_STOP_KEY, { setId: last.id!, at } satisfies RestStop)
}
export const clearRestStop = () => db.meta.delete(REST_STOP_KEY)

// ---------- Weight ----------

export const MIN_WEIGHT_LB = 50
export const MAX_WEIGHT_LB = 700
const WEIGHT_GOAL_KEY = 'weightGoal'
export const getWeightGoal = () => getMeta<WeightGoal>(WEIGHT_GOAL_KEY)
export const clearWeightGoal = () => db.meta.delete(WEIGHT_GOAL_KEY)
export async function setWeightGoal(goal: WeightGoal) {
  await setMeta(WEIGHT_GOAL_KEY, goal)
}

/** Target pace for Projections, lb per week (always positive; the goal sets the direction). */
export const MIN_TARGET_RATE = 0.25
export const MAX_TARGET_RATE = 3
const TARGET_RATE_KEY = 'weightTargetRate'
export const getTargetRate = () => getMeta<number>(TARGET_RATE_KEY)
export async function setTargetRate(rate: number) {
  await setMeta(TARGET_RATE_KEY, rate)
}
const validRate = (r: unknown): r is number => typeof r === 'number' && isFinite(r) && r >= MIN_TARGET_RATE && r <= MAX_TARGET_RATE

/**
 * Saves the weigh-in for `date`, replacing that day's entry if there is one.
 * When editing an entry and its date changes, `fromDate` is removed in the same transaction.
 */
export async function saveWeight(date: string, weight: number, fromDate?: string) {
  const now = Date.now()
  await db.transaction('rw', db.weights, async () => {
    if (fromDate && fromDate !== date) await db.weights.where('date').equals(fromDate).delete()
    const existing = await db.weights.where('date').equals(date).first()
    if (existing) await db.weights.update(existing.id!, { weight, updatedAt: now })
    else await db.weights.add({ date, weight, createdAt: now, updatedAt: now })
  })
}

export async function deleteWeight(date: string) {
  await db.weights.where('date').equals(date).delete()
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

/** Current backup format. v1: original. v2: adds exercises.assistable and sets.assist. v3: adds weights and weightGoal. v4: adds weightTargetRate. */
export const BACKUP_VERSION = 4

export interface BackupFile {
  app: 'workout-log'
  version: number
  exportedAt: string
  exercises: Exercise[]
  workouts: Workout[]
  workoutExercises: WorkoutExercise[]
  sets: SetEntry[]
  /** v3+ */
  weights?: WeightEntry[]
  /** v3+. null = no goal. */
  weightGoal?: WeightGoal | null
  /** v4+. lb per week, null = not set. */
  weightTargetRate?: number | null
}

export async function exportData(): Promise<BackupFile> {
  return {
    app: 'workout-log',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    exercises: await db.exercises.toArray(),
    workouts: await db.workouts.toArray(),
    workoutExercises: await db.workoutExercises.toArray(),
    sets: await db.sets.toArray(),
    weights: await db.weights.orderBy('date').toArray(),
    weightGoal: (await getWeightGoal()) ?? null,
    weightTargetRate: (await getTargetRate()) ?? null,
  }
}

export async function importData(data: BackupFile) {
  if (
    data?.app !== 'workout-log' ||
    !Array.isArray(data.exercises) ||
    !Array.isArray(data.workouts) ||
    !Array.isArray(data.workoutExercises) ||
    !Array.isArray(data.sets)
  ) {
    throw new Error("That file isn't a Workout Log backup.")
  }
  const v = data.version
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error('That backup has no valid format version, so it can’t be restored safely.')
  }
  if (v > BACKUP_VERSION) {
    throw new Error(`That backup is format v${v}, newer than this app understands (v${BACKUP_VERSION}). Update the app first: close it fully and reopen.`)
  }
  // v1 → v2: flag the default assistable exercises, same as the database upgrade.
  const exercises = v < 2 ? data.exercises.map((e) => (isDefaultAssistable(e) ? { ...e, assistable: true } : e)) : data.exercises
  // v1/v2 files have no weights or goal; restoring one replaces those too (empty), like everything else.
  const weights = v >= 3 && Array.isArray(data.weights) ? data.weights : []
  if (!weights.every((w) => w && /^\d{4}-\d{2}-\d{2}$/.test(w.date) && typeof w.weight === 'number' && isFinite(w.weight))) {
    throw new Error('That backup has a weigh-in it can’t read, so it can’t be restored safely.')
  }
  const goal = v >= 3 && data.weightGoal && typeof data.weightGoal.weight === 'number' ? data.weightGoal : null
  // v1–v3 files have no target rate; restoring one clears it.
  const targetRate = v >= 4 && validRate(data.weightTargetRate) ? data.weightTargetRate : null
  await db.transaction('rw', [db.exercises, db.workouts, db.workoutExercises, db.sets, db.weights, db.meta], async () => {
    await Promise.all([db.exercises.clear(), db.workouts.clear(), db.workoutExercises.clear(), db.sets.clear(), db.weights.clear()])
    await db.exercises.bulkAdd(exercises)
    await db.workouts.bulkAdd(data.workouts)
    await db.workoutExercises.bulkAdd(data.workoutExercises)
    await db.sets.bulkAdd(data.sets)
    await db.weights.bulkAdd(weights)
    if (goal) await db.meta.put({ key: WEIGHT_GOAL_KEY, value: goal })
    else await db.meta.delete(WEIGHT_GOAL_KEY)
    if (targetRate != null) await db.meta.put({ key: TARGET_RATE_KEY, value: targetRate })
    else await db.meta.delete(TARGET_RATE_KEY)
  })
}
