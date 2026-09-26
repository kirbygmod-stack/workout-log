import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, SECTIONS, type Exercise, type Kind, type Section } from '../db'
import { durationInput, fmtDate, fmtDuration, fmtSet, parseDuration } from '../format'
import { Sheet } from '../components/Sheet'

const KIND_LABEL: Record<Kind, string> = {
  weight: 'Weight × reps',
  bodyweight: 'Reps (+ optional weight)',
  timed: 'Time hold',
  cardio: 'Cardio',
}

function defaultKind(section: Section): Kind {
  if (section === 'cardio') return 'cardio'
  if (section === 'bodyweight') return 'bodyweight'
  return 'weight'
}

export function Exercises() {
  const exercises = useLiveQuery(() => db.exercises.toArray(), [])
  const [editing, setEditing] = useState<Exercise | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  if (!exercises) return null
  const archivedCount = exercises.filter((e) => e.archived).length

  return (
    <div>
      <h1>Exercises</h1>
      {SECTIONS.map((s) => {
        const list = exercises.filter((e) => e.section === s.id && (showArchived || !e.archived)).sort((a, b) => a.name.localeCompare(b.name))
        return (
          <section key={s.id} className="ex-section">
            <div className="row between">
              <h2>{s.label}</h2>
              <button
                className="btn ghost small"
                onClick={() =>
                  setEditing({ name: '', section: s.id, kind: defaultKind(s.id), targetRestSec: s.id === 'cardio' ? 0 : 90, createdAt: Date.now(), ...(s.id === 'cardio' ? { levelLabel: 'Incline / Level' } : {}) })
                }
              >
                + Add
              </button>
            </div>
            <ul className="ex-list">
              {list.map((e) => (
                <li key={e.id}>
                  <button className="ex-row" onClick={() => setEditing(e)}>
                    <span className={e.archived ? 'muted' : ''}>
                      {e.name}
                      {e.archived ? ' (hidden)' : ''}
                    </span>
                    <span className="muted small">{e.kind === 'cardio' ? '' : `rest ${fmtDuration(e.targetRestSec)}`}</span>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="muted small pad">None yet</li>}
            </ul>
          </section>
        )
      })}
      {archivedCount > 0 && (
        <button className="btn ghost" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? 'Hide' : 'Show'} {archivedCount} hidden exercise{archivedCount > 1 ? 's' : ''}
        </button>
      )}
      {editing && <ExerciseEditor exercise={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ExerciseEditor({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const isNew = exercise.id == null
  const [name, setName] = useState(exercise.name)
  const [section, setSection] = useState<Section>(exercise.section)
  const [kind, setKind] = useState<Kind>(exercise.kind)
  const [rest, setRest] = useState(durationInput(exercise.targetRestSec))
  const [levelLabel, setLevelLabel] = useState(exercise.levelLabel ?? 'Incline / Level')
  const [assistable, setAssistable] = useState(!!exercise.assistable)
  const [error, setError] = useState('')

  const history = useLiveQuery(async () => {
    if (isNew) return { sessions: [], count: 0 }
    const wes = await db.workoutExercises.where('exerciseId').equals(exercise.id!).reverse().sortBy('id')
    const sessions = []
    for (const we of wes.slice(0, 8)) {
      const w = await db.workouts.get(we.workoutId)
      const sets = await db.sets.where('workoutExerciseId').equals(we.id!).sortBy('completedAt')
      if (w && sets.length) sessions.push({ w, sets })
    }
    const count = await db.sets.where('exerciseId').equals(exercise.id!).count()
    return { sessions, count }
  }, [exercise.id])

  const save = async () => {
    const n = name.trim()
    if (!n) return setError('Name it first.')
    const restSec = parseDuration(rest, 'sec') ?? 0
    const k: Kind = section === 'cardio' ? 'cardio' : kind === 'cardio' ? defaultKind(section) : kind
    const data: Exercise = {
      ...exercise,
      name: n,
      section,
      kind: k,
      targetRestSec: restSec,
      levelLabel: k === 'cardio' ? levelLabel.trim() : undefined,
      assistable: k === 'bodyweight' && assistable ? true : undefined,
    }
    if (isNew) await db.exercises.add(data)
    else await db.exercises.put(data)
    onClose()
  }

  const remove = async () => {
    if (history && history.count > 0) {
      if (confirm(`${exercise.name} has ${history.count} logged set(s). Hide it from the list? Its history is kept.`)) {
        await db.exercises.update(exercise.id!, { archived: true })
        onClose()
      }
    } else if (confirm(`Delete ${exercise.name}?`)) {
      await db.transaction('rw', db.exercises, db.workoutExercises, async () => {
        await db.workoutExercises.where('exerciseId').equals(exercise.id!).delete()
        await db.exercises.delete(exercise.id!)
      })
      onClose()
    }
  }

  const effectiveKind: Kind = section === 'cardio' ? 'cardio' : kind === 'cardio' ? defaultKind(section) : kind

  return (
    <Sheet title={isNew ? 'New exercise' : 'Edit exercise'} onClose={onClose}>
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus={isNew} />
      </label>
      <label className="field">
        <span className="field-label">Section</span>
        <select className="input" value={section} onChange={(e) => setSection(e.target.value as Section)}>
          {SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {section !== 'cardio' && (
        <label className="field">
          <span className="field-label">Logged as</span>
          <select className="input" value={effectiveKind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(['weight', 'bodyweight', 'timed'] as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      {effectiveKind === 'bodyweight' && (
        <label className="field check-field">
          <input type="checkbox" checked={assistable} onChange={(e) => setAssistable(e.target.checked)} />
          <span>
            Assisted option
            <span className="muted small"> · log assist lbs (machine or band); less assist counts as progress</span>
          </span>
        </label>
      )}
      {section === 'cardio' ? (
        <label className="field">
          <span className="field-label">Incline/level field label (blank = no field)</span>
          <input className="input" value={levelLabel} onChange={(e) => setLevelLabel(e.target.value)} placeholder="e.g. Incline %, Level" />
        </label>
      ) : (
        <label className="field">
          <span className="field-label">Target rest (m:ss)</span>
          <input className="input" inputMode="text" value={rest} onChange={(e) => setRest(e.target.value)} placeholder="1:30" />
        </label>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row gap">
        <button className="btn primary grow" onClick={save}>
          Save
        </button>
        {!isNew && !exercise.archived && (
          <button className="btn danger" onClick={remove}>
            Delete
          </button>
        )}
        {exercise.archived && (
          <button
            className="btn"
            onClick={async () => {
              await db.exercises.update(exercise.id!, { archived: false })
              onClose()
            }}
          >
            Unhide
          </button>
        )}
      </div>

      {!isNew && history && history.sessions.length > 0 && (
        <div className="ex-history">
          <h3>Recent</h3>
          <ul>
            {history.sessions.map(({ w, sets }) => (
              <li key={w.id}>
                <span className="muted small">{fmtDate(w.startedAt)}</span>
                <div>{sets.map((s) => fmtSet({ kind: exercise.kind, levelLabel: exercise.levelLabel }, s)).join(', ')}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  )
}
