import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, workoutTypeLabel } from '../db'
import { fmtDate, fmtDuration } from '../format'
import { WorkoutView } from '../components/WorkoutView'

const PAGE = 30

export function History() {
  const [openId, setOpenId] = useState<number | null>(null)
  const [limit, setLimit] = useState(PAGE)

  const rows = useLiveQuery(async () => {
    const ws = (await db.workouts.orderBy('startedAt').reverse().toArray()).filter((w) => w.endedAt)
    const page = ws.slice(0, limit)
    const exMap = new Map((await db.exercises.toArray()).map((e) => [e.id!, e.name]))
    const out = []
    for (const w of page) {
      const wes = await db.workoutExercises.where('workoutId').equals(w.id!).sortBy('order')
      const setCount = await db.sets.where('workoutId').equals(w.id!).count()
      out.push({ w, names: wes.map((x) => exMap.get(x.exerciseId) ?? '?'), setCount })
    }
    return { out, total: ws.length }
  }, [limit])

  if (openId != null) return <WorkoutView workoutId={openId} onClose={() => setOpenId(null)} />
  if (!rows) return null

  return (
    <div>
      <h1>History</h1>
      {rows.total === 0 && <p className="muted">Finished workouts show up here.</p>}
      <ul className="history">
        {rows.out.map(({ w, names, setCount }) => (
          <li key={w.id}>
            <button className="history-row" onClick={() => setOpenId(w.id!)}>
              <div className="row between">
                <strong>
                  {workoutTypeLabel(w.type)} <span className="muted">· {fmtDate(w.startedAt)}</span>
                </strong>
                <span className="muted small mono">{fmtDuration((w.endedAt! - w.startedAt) / 1000)}</span>
              </div>
              <div className="muted small clamp">
                {setCount} sets · {names.join(', ') || 'no exercises'}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {rows.total > limit && (
        <button className="btn ghost" onClick={() => setLimit(limit + PAGE)}>
          Show more
        </button>
      )}
    </div>
  )
}
