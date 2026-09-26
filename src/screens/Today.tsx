import { useLiveQuery } from 'dexie-react-hooks'
import { db, getMeta, startWorkout, WORKOUT_TYPES, workoutTypeLabel, type Workout, type WorkoutType } from '../db'
import { daysAgo } from '../format'
import { WorkoutView } from '../components/WorkoutView'

export const BACKUP_REMINDER_DAYS = 7

export function Today({ goToSettings }: { goToSettings: () => void }) {
  const state = useLiveQuery(async () => {
    const all = await db.workouts.orderBy('startedAt').reverse().toArray()
    const active = all.find((w) => !w.endedAt)
    const lastByType: Partial<Record<WorkoutType, Workout>> = {}
    for (const w of all) if (w.endedAt && !lastByType[w.type]) lastByType[w.type] = w
    const lastFinished = all.find((w) => w.endedAt)
    const lastBackup = await getMeta<number>('lastBackupAt')
    const needsBackup = all.length > 0 && (!lastBackup || Date.now() - lastBackup > BACKUP_REMINDER_DAYS * 86400000)
    return { active, lastByType, lastFinished, needsBackup, lastBackup }
  }, [])

  if (!state) return null
  if (state.active) return <WorkoutView workoutId={state.active.id!} />

  const { lastByType, lastFinished, needsBackup, lastBackup } = state
  const suggested = lastFinished ? nextInRotation(lastFinished.type) : undefined

  return (
    <div className="today">
      {needsBackup && (
        <button className="banner" onClick={goToSettings}>
          {lastBackup ? `Last backup ${daysAgo(lastBackup)}.` : 'No backup yet.'} Tap to back up your data.
        </button>
      )}
      <h1>Start a workout</h1>
      {lastFinished && (
        <p className="muted">
          Last: {workoutTypeLabel(lastFinished.type)} {daysAgo(lastFinished.startedAt)}
        </p>
      )}
      <div className="start-grid">
        {WORKOUT_TYPES.map((t) => {
          const prev = lastByType[t.id]
          return (
            <div key={t.id} className={`start-card ${suggested === t.id ? 'suggested' : ''}`}>
              <button className="start-main" onClick={() => startWorkout(t.id)}>
                <span className="start-title">{t.label}</span>
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
