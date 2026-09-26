import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db, lastSetInWorkout, MAX_RECORDED_REST_SEC } from '../db'
import { fmtDuration } from '../format'
import { beep } from '../audio'

/** Counts up from the last logged set; target comes from that set's exercise. */
export function RestTimer({ workoutId }: { workoutId: number }) {
  const info = useLiveQuery(async () => {
    const s = await lastSetInWorkout(workoutId)
    if (!s) return null
    const ex = await db.exercises.get(s.exerciseId)
    return { at: s.completedAt, id: s.id, target: ex?.targetRestSec ?? 0, name: ex?.name ?? '' }
  }, [workoutId])
  const [now, setNow] = useState(() => Date.now())
  const beeped = useRef<number | undefined>(undefined)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const elapsed = info ? Math.max(0, (now - info.at) / 1000) : 0
  const done = !!info && info.target > 0 && elapsed >= info.target

  useEffect(() => {
    if (done && info && beeped.current !== info.id && elapsed < info.target + 3) {
      beeped.current = info.id
      beep()
    }
  }, [done, info, elapsed])

  if (!info || info.target <= 0 || elapsed > MAX_RECORDED_REST_SEC) return null
  const pct = info.target > 0 ? Math.min(1, elapsed / info.target) : 0

  return (
    <div className={`rest ${done ? 'done' : ''}`} aria-live="polite">
      <div className="rest-bar" style={{ transform: `scaleX(${pct})` }} />
      <div className="rest-inner">
        <span className="muted small">Rest · after {info.name}</span>
        <span className="rest-time">
          {fmtDuration(elapsed)}
          {info.target > 0 && <span className="muted"> / {fmtDuration(info.target)}</span>}
        </span>
      </div>
    </div>
  )
}
