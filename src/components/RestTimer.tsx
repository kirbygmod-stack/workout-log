import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db, getRestStop, lastSetInWorkout, MAX_RECORDED_REST_SEC, stopRest } from '../db'
import { fmtDuration } from '../format'
import { beep, unlockAudio } from '../audio'

const R = 21
const CIRC = 2 * Math.PI * R

/**
 * Counts up from the last logged set; target comes from that set's exercise.
 * Resting = dim mint, Ready (target hit) = bright mint + glow, Stopped = frozen grey.
 */
export function RestTimer({ workoutId }: { workoutId: number }) {
  const info = useLiveQuery(async () => {
    const s = await lastSetInWorkout(workoutId)
    if (!s) return null
    const ex = await db.exercises.get(s.exerciseId)
    const stop = await getRestStop()
    return {
      at: s.completedAt,
      id: s.id,
      target: ex?.targetRestSec ?? 0,
      stoppedAt: stop && stop.setId === s.id ? stop.at : undefined,
    }
  }, [workoutId])
  const [now, setNow] = useState(() => Date.now())
  // +30s taps apply to the current rest only; they reset when the next set is logged.
  const [extra, setExtra] = useState<{ id?: number; sec: number }>({ sec: 0 })
  const beeped = useRef<number | undefined>(undefined)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  const stopped = info?.stoppedAt != null
  const target = info ? info.target + (extra.id === info.id ? extra.sec : 0) : 0
  const elapsed = info ? Math.max(0, ((info.stoppedAt ?? now) - info.at) / 1000) : 0
  const done = !!info && !stopped && target > 0 && elapsed >= target

  useEffect(() => {
    if (done && info && beeped.current !== info.id && elapsed < target + 3) {
      beeped.current = info.id
      beep()
    }
  }, [done, info, elapsed, target])

  if (!info || info.target <= 0 || elapsed > MAX_RECORDED_REST_SEC) return null
  const pct = Math.min(1, elapsed / target)
  const state = stopped ? 'stopped' : done ? 'done' : 'resting'
  const label = stopped ? 'Stopped · rest saved' : done ? 'Ready · target hit' : 'Resting'

  return (
    <div className={`card rest ${state}`} aria-live="polite">
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="6" />
        <circle
          className="rest-ring"
          cx="26"
          cy="26"
          r={R}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - pct)}
          transform="rotate(-90 26 26)"
        />
      </svg>
      <div className="grow">
        <div className="rest-label">{label}</div>
        <div className="rest-time mono">
          <span className="rest-elapsed">{fmtDuration(elapsed)}</span>
          <span className="rest-target"> / {fmtDuration(target)}</span>
        </div>
      </div>
      <div className="rest-actions">
        <button
          className="rest-stop"
          aria-label="Stop rest timer"
          disabled={stopped}
          onClick={() => {
            unlockAudio()
            stopRest(workoutId)
          }}
        >
          <span className="rest-stop-icon" />
        </button>
        <button
          className="btn quiet mono rest-plus"
          disabled={stopped}
          onClick={() => {
            unlockAudio()
            if (done) beeped.current = undefined
            setExtra((x) => ({ id: info.id, sec: (x.id === info.id ? x.sec : 0) + 30 }))
          }}
        >
          +30s
        </button>
      </div>
    </div>
  )
}
