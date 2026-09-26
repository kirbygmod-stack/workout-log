import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, lastSessionFor, lastSetInWorkout, MAX_RECORDED_REST_SEC, removeWorkoutExercise, type Exercise, type SetEntry, type WorkoutExercise } from '../db'
import { fmtDuration, fmtNum, fmtSet } from '../format'
import { bestE1rm, fmtSession, fmtTile, setDelta } from '../stats'
import { SetForm, type SetValues } from './SetForm'
import { Sheet } from './Sheet'
import { Icon } from './Icon'
import { unlockAudio } from '../audio'

export function ExerciseCard({
  we,
  exercise,
  live,
  onMove,
  onRemoved,
  onLogged,
}: {
  we: WorkoutExercise
  exercise: Exercise
  /** Live = the workout in progress (rest is timed automatically, the log form is always open). */
  live: boolean
  onMove: (dir: -1 | 1) => void
  onRemoved?: () => void
  /** Called before a set is saved (lets the live view pin this exercise as current). */
  onLogged?: () => void
}) {
  const sets = useLiveQuery(() => db.sets.where('workoutExerciseId').equals(we.id!).sortBy('completedAt'), [we.id])
  const last = useLiveQuery(() => lastSessionFor(exercise.id!, we.workoutId), [exercise.id, we.workoutId])
  const [editing, setEditing] = useState<{ set: SetEntry; index: number } | null>(null)
  const [notesOpen, setNotesOpen] = useState(!!we.notes)
  const [adding, setAdding] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Wait for last session too, so the form can pre-fill from it.
  if (!sets || last === undefined) return null
  const kind = exercise.kind

  // Pre-fill: previous set this session, else the matching set from last session.
  const idx = sets.length
  const template = sets.at(-1) ?? last?.sets[Math.min(idx, (last?.sets.length ?? 1) - 1)]
  const initial: SetValues | undefined = template && {
    weight: template.weight,
    assist: exercise.assistable ? template.assist : undefined,
    reps: template.reps,
    durationSec: template.durationSec,
    speed: template.speed,
    level: template.level,
    calories: kind === 'cardio' ? undefined : template.calories,
  }

  const logSet = async (v: SetValues) => {
    unlockAudio()
    onLogged?.()
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

  // e1RM badge: today's best vs last session's best (weighted lifts only).
  let badge: { text: string; down: boolean } | null = null
  if (kind === 'weight') {
    const today = bestE1rm(sets)
    const before = last ? bestE1rm(last.sets) : 0
    if (today && before) {
      const pct = ((today - before) / before) * 100
      const sign = pct > 0.05 ? '▲' : pct < -0.05 ? '▼' : ''
      badge = { text: `e1RM ${Math.round(today)}${sign ? ` ${sign}${Math.abs(pct).toFixed(1)}%` : ''}`, down: pct < -0.05 }
    } else if (today || before) {
      badge = { text: `e1RM ${Math.round(today || before)}`, down: false }
    }
  }

  const showForm = live || adding
  const lastLine = last ? (kind === 'cardio' ? last.sets.map((s) => fmtSet(exercise, s)).join(' · ') : fmtSession(kind, last.sets, exercise.assistable)) : null

  return (
    <section className={`card ex-card ${live ? 'focus' : ''}`}>
      <header className="ex-head">
        <h3 className="ex-title">{exercise.name}</h3>
        {badge && <span className={`pill-badge mono ${badge.down ? 'down' : ''}`}>{badge.text}</span>}
        <div className="menu">
          <button className="icon-btn" aria-label="Exercise options" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name="more" />
          </button>
          {menuOpen && (
            <>
              <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="menu-pop" role="menu">
                <button role="menuitem" onClick={() => (onMove(-1), setMenuOpen(false))}>
                  Move earlier
                </button>
                <button role="menuitem" onClick={() => (onMove(1), setMenuOpen(false))}>
                  Move later
                </button>
                <button role="menuitem" onClick={() => (setNotesOpen(true), setMenuOpen(false))}>
                  Add notes
                </button>
                <button
                  role="menuitem"
                  className="danger-text"
                  onClick={async () => {
                    setMenuOpen(false)
                    if (sets.length === 0 || confirm(`Remove ${exercise.name} and its ${sets.length} set(s) from this workout?`)) {
                      await removeWorkoutExercise(we.id!)
                      onRemoved?.()
                    }
                  }}
                >
                  Remove from workout
                </button>
              </div>
            </>
          )}
        </div>
      </header>
      <div className="ex-last mono muted">{lastLine ? `last · ${lastLine}` : 'first time logging this'}</div>

      {(sets.length > 0 || (live && kind !== 'cardio')) && (
        <ol className="tiles">
          {sets.map((s, i) => {
            const delta = setDelta(kind, s, last?.sets[i])
            return (
              <li key={s.id}>
                <button className="tile" onClick={() => setEditing({ set: s, index: i })} aria-label={`Edit set ${i + 1}`}>
                  <span className="tile-val mono">{fmtTile(kind, s, exercise.assistable)}</span>
                  <span className={`tile-sub mono ${delta ? (delta.up ? 'up' : 'down') : ''}`}>
                    {kind === 'cardio'
                      ? `${fmtNum(s.speed)} mph`
                      : delta
                        ? `set ${i + 1} ${delta.text}`
                        : s.restSec != null
                          ? `set ${i + 1} · ${fmtDuration(s.restSec)}`
                          : `set ${i + 1}`}
                  </span>
                </button>
              </li>
            )
          })}
          {live && kind !== 'cardio' && (
            <li>
              <div className="tile now">
                <span className="tile-val mono">set {sets.length + 1}</span>
                <span className="tile-sub mono">now</span>
              </div>
            </li>
          )}
        </ol>
      )}

      {showForm ? (
        <SetForm
          key={sets.length}
          exercise={exercise}
          initial={initial}
          submitLabel={kind === 'cardio' ? 'Log session' : `Log set ${sets.length + 1}`}
          onSubmit={logSet}
          onCancel={live ? undefined : () => setAdding(false)}
        />
      ) : (
        <button className="btn ghost add-set" onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} /> Add set
        </button>
      )}

      {notesOpen && (
        <textarea
          className="input notes"
          placeholder="Notes (seat height, grip, how it felt…)"
          defaultValue={we.notes ?? ''}
          onChange={(e) => db.workoutExercises.update(we.id!, { notes: e.target.value })}
        />
      )}

      {editing && (
        <Sheet title={`${exercise.name} · set ${editing.index + 1}`} onClose={() => setEditing(null)}>
          <SetForm
            exercise={exercise}
            initial={editing.set}
            showRest
            submitLabel="Save"
            onSubmit={async (v) => {
              // Explicit undefineds clear fields the edit removed (e.g. switching Assist → Added).
              await db.sets.update(editing.set.id!, { weight: undefined, assist: undefined, ...v, restSec: v.restSec })
              setEditing(null)
            }}
            onDelete={async () => {
              await db.sets.delete(editing.set.id!)
              setEditing(null)
            }}
          />
        </Sheet>
      )}
    </section>
  )
}
