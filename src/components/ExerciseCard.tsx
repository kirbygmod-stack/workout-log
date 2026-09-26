import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, lastSessionFor, lastSetInWorkout, MAX_RECORDED_REST_SEC, removeWorkoutExercise, type Exercise, type WorkoutExercise } from '../db'
import { daysAgo, fmtDuration, fmtSet } from '../format'
import { SetForm, type SetValues } from './SetForm'
import { unlockAudio } from '../audio'

export function ExerciseCard({
  we,
  exercise,
  live,
  onMove,
}: {
  we: WorkoutExercise
  exercise: Exercise
  /** Live = the workout in progress (rest is timed automatically). */
  live: boolean
  onMove: (dir: -1 | 1) => void
}) {
  const sets = useLiveQuery(() => db.sets.where('workoutExerciseId').equals(we.id!).sortBy('completedAt'), [we.id])
  const last = useLiveQuery(() => lastSessionFor(exercise.id!, we.workoutId), [exercise.id, we.workoutId])
  const [editing, setEditing] = useState<number | null>(null)
  const [notesOpen, setNotesOpen] = useState(!!we.notes)
  const [adding, setAdding] = useState(false)

  // Wait for last session too, so the form can pre-fill from it.
  if (!sets || last === undefined) return null

  // Pre-fill: previous set this session, else the matching set from last session.
  const idx = sets.length
  const template = sets.at(-1) ?? last?.sets[Math.min(idx, (last?.sets.length ?? 1) - 1)]
  const initial: SetValues | undefined = template && {
    weight: template.weight,
    reps: template.reps,
    durationSec: template.durationSec,
    speed: template.speed,
    level: template.level,
    calories: exercise.kind === 'cardio' ? undefined : template.calories,
  }

  const logSet = async (v: SetValues) => {
    unlockAudio()
    const now = Date.now()
    let restSec: number | undefined
    if (live) {
      const prev = await lastSetInWorkout(we.workoutId)
      if (prev) {
        const r = Math.round((now - prev.completedAt) / 1000)
        if (r <= MAX_RECORDED_REST_SEC) restSec = r
      }
    }
    await db.sets.add({
      ...v,
      restSec,
      workoutExerciseId: we.id!,
      workoutId: we.workoutId,
      exerciseId: exercise.id!,
      completedAt: now,
    })
    setAdding(false)
  }

  const showForm = live || adding

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h3>{exercise.name}</h3>
          {last ? (
            <div className="last">
              <span className="muted">Last ({daysAgo(last.workout.startedAt)}): </span>
              {last.sets.map((s) => fmtSet(exercise, s)).join(', ')}
            </div>
          ) : (
            <div className="last muted">First time logging this</div>
          )}
          {last?.we.notes?.trim() && <div className="last-notes muted">📝 {last.we.notes}</div>}
        </div>
        <details className="menu">
          <summary aria-label="Exercise options">⋯</summary>
          <div className="menu-pop">
            <button onClick={() => onMove(-1)}>Move up</button>
            <button onClick={() => onMove(1)}>Move down</button>
            <button onClick={() => setNotesOpen(true)}>Add notes</button>
            <button
              className="danger-text"
              onClick={() => {
                if (sets.length === 0 || confirm(`Remove ${exercise.name} and its ${sets.length} set(s) from this workout?`)) removeWorkoutExercise(we.id!)
              }}
            >
              Remove from workout
            </button>
          </div>
        </details>
      </header>

      {sets.length > 0 && (
        <ol className="sets">
          {sets.map((s, i) =>
            editing === s.id ? (
              <li key={s.id} className="set-edit">
                <SetForm
                  exercise={exercise}
                  initial={s}
                  showRest
                  submitLabel="Save"
                  onSubmit={async (v) => {
                    await db.sets.update(s.id!, { ...v, restSec: v.restSec })
                    setEditing(null)
                  }}
                  onCancel={() => setEditing(null)}
                  onDelete={async () => {
                    await db.sets.delete(s.id!)
                    setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={s.id}>
                <button className="set-row" onClick={() => setEditing(s.id!)}>
                  <span className="set-no">{i + 1}</span>
                  <span className="set-val">{fmtSet(exercise, s)}</span>
                  <span className="set-rest muted">{s.restSec != null ? `rest ${fmtDuration(s.restSec)}` : ''}</span>
                </button>
              </li>
            ),
          )}
        </ol>
      )}

      {showForm ? (
        <SetForm
          key={sets.length}
          exercise={exercise}
          initial={initial}
          submitLabel={exercise.kind === 'cardio' ? 'Log session' : `Log set ${sets.length + 1}`}
          onSubmit={logSet}
          onCancel={live ? undefined : () => setAdding(false)}
        />
      ) : (
        <button className="btn ghost" onClick={() => setAdding(true)}>
          + Add set
        </button>
      )}

      {notesOpen ? (
        <textarea
          className="input notes"
          placeholder="Notes (seat height, grip, how it felt…)"
          defaultValue={we.notes ?? ''}
          onChange={(e) => db.workoutExercises.update(we.id!, { notes: e.target.value })}
        />
      ) : null}
    </section>
  )
}
