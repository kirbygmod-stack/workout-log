import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, getMeta, startWorkout, WORKOUT_TYPES, workoutTypeLabel, type Workout, type WorkoutType } from '../db'
import { daysAgo, fmtDate } from '../format'
import { WorkoutView } from '../components/WorkoutView'
import { weeklyStrengthChange } from '../progress'

export const BACKUP_REMINDER_DAYS = 7

export function Today({ goToSettings }: { goToSettings: () => void }) {
  const [today] = useState(() => Date.now())
  const state = useLiveQuery(async () => {
    const all = await db.workouts.orderBy('startedAt').reverse().toArray()
    const active = all.find((w) => !w.endedAt)
    const lastByType: Partial<Record<WorkoutType, Workout>> = {}
    for (const w of all) if (w.endedAt && !lastByType[w.type]) lastByType[w.type] = w
    const lastFinished = all.find((w) => w.endedAt)
    const lastBackup = await getMeta<number>('lastBackupAt')
    const needsBackup = all.length > 0 && (!lastBackup || Date.now() - lastBackup > BACKUP_REMINDER_DAYS * 86400000)
    const [sets, exercises] = await Promise.all([db.sets.toArray(), db.exercises.toArray()])
    const kinds = new Map(exercises.map((e) => [e.id!, e.kind]))
    const strength = weeklyStrengthChange(sets, all, (id) => kinds.get(id))
    return { active, lastByType, lastFinished, needsBackup, lastBackup, strength }
  }, [])

  if (!state) return null
  if (state.active) return <WorkoutView workoutId={state.active.id!} />

  const { lastByType, lastFinished, needsBackup, lastBackup, strength } = state
  const suggested = lastFinished ? nextInRotation(lastFinished.type) : undefined

  return (
    <div className="today">
      {needsBackup && (
        <button className="banner" onClick={goToSettings}>
          {lastBackup ? `Last backup ${daysAgo(lastBackup)}.` : 'No backup yet.'} Tap to back up your data.
        </button>
      )}
      <div className="today-head">
        <div className="date-line">{fmtDate(today)}</div>
        <h1>Start a workout</h1>
        {lastFinished && (
          <div className="muted small">
            Last: {workoutTypeLabel(lastFinished.type)} {daysAgo(lastFinished.startedAt)}
          </div>
        )}
      </div>
      <div className="start-grid">
        {WORKOUT_TYPES.map((t) => {
          const prev = lastByType[t.id]
          const pct = strength[t.id]
          // Direction comes from the raw change, so any decrease is red even if it rounds to 0.0%.
          const dir = pct == null || pct === 0 ? '' : pct > 0 ? 'up' : 'down'
          return (
            <div key={t.id} className={`start-card ${suggested === t.id ? 'suggested' : ''}`}>
              <button className="start-main" onClick={() => startWorkout(t.id)}>
                <span className="start-head">
                  <span className="start-title">{t.label}</span>
                  <span className={`start-strength ${dir}`}>
                    <span className="start-pct">
                      {pct == null ? '—' : `${dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''}${Math.abs(pct).toFixed(1)}%`}
                    </span>
                    {pct != null && <span className="start-strength-label">vs last week</span>}
                  </span>
                </span>
                <span className="muted small">{prev ? `last ${daysAgo(prev.startedAt)}` : 'not logged yet'}</span>
                {suggested === t.id && <span className="badge">Up next</span>}
              </button>
              {prev && (
                <button className="start-copy" onClick={() => startWorkout(t.id, prev.id)}>
                  Repeat last {t.label}’s exercises
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function nextInRotation(t: WorkoutType): WorkoutType | undefined {
  if (t === 'push') return 'pull'
  if (t === 'pull') return 'legs'
  if (t === 'legs') return 'push'
  return undefined
}
