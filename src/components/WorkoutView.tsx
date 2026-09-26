import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { addExerciseToWorkout, db, deleteWorkout, finishWorkout, WORKOUT_TYPES, workoutTypeLabel, type WorkoutType } from '../db'
import { fmtDate, fmtDuration, fmtTime } from '../format'
import { ExerciseCard } from './ExerciseCard'
import { ExercisePicker } from './ExercisePicker'
import { RestTimer } from './RestTimer'

function Elapsed({ from }: { from: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{fmtDuration((now - from) / 1000)}</>
}

/** Shows a workout: the live one being logged, or a past one being reviewed/edited. */
export function WorkoutView({ workoutId, onClose }: { workoutId: number; onClose?: () => void }) {
  const data = useLiveQuery(async () => {
    const workout = await db.workouts.get(workoutId)
    if (!workout) return { workout: undefined, items: [] }
    const wes = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order')
    const exs = await db.exercises.bulkGet(wes.map((w) => w.exerciseId))
    return { workout, items: wes.map((we, i) => ({ we, ex: exs[i]! })).filter((x) => x.ex) }
  }, [workoutId])
  const [picking, setPicking] = useState(false)

  if (!data) return null
  const { workout, items } = data
  if (!workout) return null
  const live = !workout.endedAt

  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir
    if (j < 0 || j >= items.length) return
    const a = items[index].we
    const b = items[j].we
    await db.transaction('rw', db.workoutExercises, async () => {
      await db.workoutExercises.update(a.id!, { order: b.order })
      await db.workoutExercises.update(b.id!, { order: a.order })
    })
  }

  return (
    <div className={`workout ${live ? 'is-live' : ''}`}>
      <div className="workout-head">
        {!live && onClose && (
          <button className="btn ghost back" onClick={onClose}>
            ‹ History
          </button>
        )}
        <div className="row between">
          <div>
            <select
              className="type-select"
              value={workout.type}
              onChange={(e) => db.workouts.update(workoutId, { type: e.target.value as WorkoutType })}
              aria-label="Workout type"
            >
              {WORKOUT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} day
                </option>
              ))}
            </select>
            <div className="muted small">
              {fmtDate(workout.startedAt)} · {fmtTime(workout.startedAt)}
              {live ? (
                <>
                  {' '}
                  · <Elapsed from={workout.startedAt} />
                </>
              ) : (
                ` · ${fmtDuration((workout.endedAt! - workout.startedAt) / 1000)}`
              )}
            </div>
          </div>
          {live && (
            <button
              className="btn primary"
              onClick={async () => {
                const n = await db.sets.where('workoutId').equals(workoutId).count()
                if (n === 0) {
                  if (confirm('No sets logged. Discard this workout?')) await deleteWorkout(workoutId)
                  return
                }
                if (confirm('Finish workout?')) await finishWorkout(workoutId)
              }}
            >
              Finish
            </button>
          )}
        </div>
      </div>

      {items.length === 0 && <p className="muted pad center">Add your first exercise to start logging.</p>}

      {items.map(({ we, ex }, i) => (
        <ExerciseCard key={we.id} we={we} exercise={ex} live={live} onMove={(d) => move(i, d)} />
      ))}

      <button className="btn add-ex" onClick={() => setPicking(true)}>
        + Add exercise
      </button>

      {live ? (
        <button
          className="btn ghost danger-text discard"
          onClick={async () => {
            if (confirm(`Discard this ${workoutTypeLabel(workout.type)} workout and everything logged in it?`)) await deleteWorkout(workoutId)
          }}
        >
          Discard workout
        </button>
      ) : (
        <button
          className="btn ghost danger-text discard"
          onClick={async () => {
            if (confirm('Delete this workout from history? This can’t be undone.')) {
              await deleteWorkout(workoutId)
              onClose?.()
            }
          }}
        >
          Delete workout
        </button>
      )}

      {live && <RestTimer workoutId={workoutId} />}

      {picking && (
        <ExercisePicker
          workoutType={workout.type}
          alreadyAdded={items.map((x) => x.ex.id!)}
          onClose={() => setPicking(false)}
          onPick={async (id) => {
            await addExerciseToWorkout(workoutId, id)
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}
