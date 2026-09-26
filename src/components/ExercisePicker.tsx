import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db, SECTIONS, type Section, type WorkoutType } from '../db'
import { Sheet } from './Sheet'

export function ExercisePicker({
  workoutType,
  alreadyAdded,
  onPick,
  onClose,
}: {
  workoutType: WorkoutType
  alreadyAdded: number[]
  onPick: (exerciseId: number) => void
  onClose: () => void
}) {
  const exercises = useLiveQuery(() => db.exercises.toArray(), [])
  const [section, setSection] = useState<Section>(workoutType === 'other' ? 'push' : workoutType)
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const all = (exercises ?? []).filter((e) => !e.archived)
    const query = q.trim().toLowerCase()
    const filtered = query ? all.filter((e) => e.name.toLowerCase().includes(query)) : all.filter((e) => e.section === section)
    return filtered.sort((a, b) => a.name.localeCompare(b.name))
  }, [exercises, section, q])

  return (
    <Sheet title="Add exercise" onClose={onClose}>
      <input className="input" placeholder="Search all exercises" value={q} onChange={(e) => setQ(e.target.value)} />
      {!q && (
        <div className="chips">
          {SECTIONS.map((s) => (
            <button key={s.id} className={`chip ${section === s.id ? 'on' : ''}`} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <ul className="pick-list">
        {list.map((e) => {
          const added = alreadyAdded.includes(e.id!)
          return (
            <li key={e.id}>
              <button className="pick-row" onClick={() => onPick(e.id!)}>
                <span>{e.name}</span>
                <span className="muted small">{added ? 'Added ✓' : q ? SECTIONS.find((s) => s.id === e.section)?.label : ''}</span>
              </button>
            </li>
          )
        })}
        {list.length === 0 && <li className="muted pad">No exercises here. Add them in the Exercises tab.</li>}
      </ul>
    </Sheet>
  )
}
