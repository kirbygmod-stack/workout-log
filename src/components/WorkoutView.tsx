import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { addExerciseToWorkout, db, deleteWorkout, finishWorkout, lastSessionFor, WORKOUT_TYPES, workoutTypeLabel, type Exercise, type WorkoutType } from '../db'
import { fmtDate, fmtDuration, fmtSet, fmtTime } from '../format'
import { fmtLbs, fmtSession, volume } from '../stats'
import { ExerciseCard } from './ExerciseCard'
import { ExercisePicker } from './ExercisePicker'
import { RestTimer } from './RestTimer'
import { Icon } from './Icon'

function Elapsed({ from }: { from: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{fmtDuration((now - from) / 1000)}</>
}

/** "Next · Incline DB Press   last 65×10 ×3" */
function NextUp({ exercise, workoutId, onGo }: { exercise: Exercise; workoutId: number; onGo: () => void }) {
  const last = useLiveQuery(() => lastSessionFor(exercise.id!, workoutId), [exercise.id, workoutId])
  const summary = last ? (exercise.kind === 'cardio' ? fmtSet(exercise, last.sets[0]) : fmtSession(exercise.kind, last.sets)) : ''
  return (
    <button className="next-up" onClick={onGo}>
      <span className="muted">
        Next · <span className="text">{exercise.name}</span>
      </span>
      {summary && <span className="mono muted small">last {summary}</span>}
    </button>
  )
}

/** Shows a workout: the live one being logged (one exercise at a time), or a past one being reviewed/edited (all stacked). */
export function WorkoutView({ workoutId, onClose }: { workoutId: number; onClose?: () => void }) {
  const data = useLiveQuery(async () => {
    const workout = await db.workouts.get(workoutId)
    if (!workout) return { workout: undefined, items: [], sets: [], session: 0 }
    const wes = await db.workoutExercises.where('workoutId').equals(workoutId).sortBy('order')
    const exs = await db.exercises.bulkGet(wes.map((w) => w.exerciseId))
    const sets = await db.sets.where('workoutId').equals(workoutId).toArray()
    const session = await db.workouts.where('startedAt').belowOrEqual(workout.startedAt).count()
    return { workout, items: wes.map((we, i) => ({ we, ex: exs[i]! })).filter((x) => x.ex), sets, session }
  }, [workoutId])
  const [picking, setPicking] = useState(false)
  const [currentId, setCurrentId] = useState<number | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const items = data?.items ?? []
  const setCount = (weId: number) => data?.sets.filter((s) => s.workoutExerciseId === weId).length ?? 0
  // Default focus: the first exercise with nothing logged yet, else the last one.
  const current = items.find((x) => x.we.id === currentId) ?? items.find((x) => setCount(x.we.id!) === 0) ?? items.at(-1)

  useEffect(() => {
    stripRef.current?.querySelector('.ex-pill.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [current?.we.id])

  if (!data) return null
  const { workout, sets, session } = data
  if (!workout) return null
  const live = !workout.endedAt
  const kindOf = (exerciseId: number) => items.find((x) => x.ex.id === exerciseId)?.ex.kind
  const vol = volume(sets, kindOf)

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

  const next = live && current ? items.find((x) => x.we.id !== current.we.id && setCount(x.we.id!) === 0 && x.we.order > current.we.order) ?? items.find((x) => x.we.id !== current.we.id && setCount(x.we.id!) === 0) : undefined

  const header = (
    <div className="workout-head">
      {!live && onClose && (
        <button className="btn ghost back" onClick={onClose}>
          <Icon name="back" size={18} /> History
        </button>
      )}
      <div className="row between end">
        <div className="head-text">
          <div className="kicker">
            {fmtDate(workout.startedAt)} · {live ? `Session ${session}` : fmtTime(workout.startedAt)}
          </div>
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
          <div className="mono muted small">
            {live ? <Elapsed from={workout.startedAt} /> : fmtDuration((workout.endedAt! - workout.startedAt) / 1000)} · {sets.length} set{sets.length === 1 ? '' : 's'}
            {vol > 0 && (
              <>
                {' '}
                · <span className="text">{fmtLbs(vol)} lb</span>
              </>
            )}
          </div>
        </div>
        {live && (
          <button
            className="btn quiet"
            onClick={async () => {
              if (sets.length === 0) {
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
  )

  const picker = picking && (
    <ExercisePicker
      workoutType={workout.type}
      alreadyAdded={items.map((x) => x.ex.id!)}
      onClose={() => setPicking(false)}
      onPick={async (id) => {
        const weId = await addExerciseToWorkout(workoutId, id)
        setCurrentId(weId as number)
        setPicking(false)
      }}
    />
  )

  if (live) {
    const currentIndex = current ? items.indexOf(current) : -1
    return (
      <div className="workout is-live">
        {header}

        <div className="ex-strip" ref={stripRef}>
          {items.map(({ we, ex }) => {
            const on = we.id === current?.we.id
            const done = setCount(we.id!) > 0
            return (
              <button key={we.id} className={`ex-pill ${on ? 'on' : ''} ${done ? 'done' : ''}`} onClick={() => setCurrentId(we.id!)} aria-current={on ? 'true' : undefined}>
                {done && !on && <Icon name="check" size={14} width={3} />}
                {ex.name}
              </button>
            )
          })}
          <button className="ex-pill add" onClick={() => setPicking(true)}>
            <Icon name="plus" size={14} width={3} /> Add
          </button>
        </div>

        {current ? (
          <ExerciseCard key={current.we.id} we={current.we} exercise={current.ex} live onMove={(d) => move(currentIndex, d)} onRemoved={() => setCurrentId(null)} onLogged={() => setCurrentId(current.we.id!)} />
        ) : (
          <div className="card empty">
            <p className="muted">Add your first exercise to start logging.</p>
            <button className="btn primary" onClick={() => setPicking(true)}>
              Add exercise
            </button>
          </div>
        )}

        <RestTimer workoutId={workoutId} />

        {next && <NextUp exercise={next.ex} workoutId={workoutId} onGo={() => setCurrentId(next.we.id!)} />}

        <button
          className="btn ghost danger-text discard"
          onClick={async () => {
            if (confirm(`Discard this ${workoutTypeLabel(workout.type)} workout and everything logged in it?`)) await deleteWorkout(workoutId)
          }}
        >
          Discard workout
        </button>

        {picker}
      </div>
    )
  }

  return (
    <div className="workout">
      {header}

      {items.length === 0 && <p className="muted pad center">No exercises in this workout.</p>}

      {items.map(({ we, ex }, i) => (
        <ExerciseCard key={we.id} we={we} exercise={ex} live={false} onMove={(d) => move(i, d)} />
      ))}

      <button className="btn add-ex" onClick={() => setPicking(true)}>
        <Icon name="plus" size={18} /> Add exercise
      </button>

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

      {picker}
    </div>
  )
}
