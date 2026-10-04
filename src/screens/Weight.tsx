import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import {
  db,
  getTargetRate,
  getWeightGoal,
} from '../db'
import { Icon } from '../components/Icon'
import {
  dayOf,
  localToday,
  trendPoints,
} from '../weight'
import { WeightChart } from './weight/chart'
import { GoalSheet, TargetRateSheet, LogSheet } from './weight/sheets'
import { TrendsCard } from './weight/trends'
import { ProjectionsCard } from './weight/projections'
import { Entries } from './weight/entries'

type SheetState = { kind: 'log'; editDate?: string } | { kind: 'goal' } | { kind: 'rate' } | null

export function Weight() {
  const [todayStr] = useState(() => localToday())
  const today = dayOf(todayStr)
  const [screen, setScreen] = useState<'main' | 'entries'>('main')
  const [sheet, setSheet] = useState<SheetState>(null)

  const data = useLiveQuery(async () => ({
    entries: await db.weights.orderBy('date').toArray(),
    goal: await getWeightGoal(),
    targetRate: await getTargetRate(),
  }))
  const pts = useMemo(() => (data ? trendPoints(data.entries) : []), [data])

  if (!data) return null
  const { goal, targetRate } = data

  const sheets = (
    <>
      {sheet?.kind === 'log' && (
        <LogSheet entries={data.entries} todayStr={todayStr} editDate={sheet.editDate} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'goal' && <GoalSheet goal={goal} pts={pts} today={today} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'rate' && <TargetRateSheet rate={targetRate} goal={goal} pts={pts} today={today} onClose={() => setSheet(null)} />}
    </>
  )

  if (screen === 'entries') {
    return (
      <>
        <Entries pts={pts} today={today} onBack={() => setScreen('main')} onEdit={(date) => setSheet({ kind: 'log', editDate: date })} />
        {sheets}
      </>
    )
  }

  return (
    <div className="weight">
      <div className="row between weight-title">
        <h1>Weight</h1>
        <button className="btn primary small log-weight" onClick={() => setSheet({ kind: 'log' })}>
          <Icon name="plus" size={16} width={2.5} /> Log weight
        </button>
      </div>

      <WeightChart pts={pts} today={today} goal={goal} />

      <TrendsCard pts={pts} today={today} goal={goal} />

      <ProjectionsCard
        pts={pts}
        today={today}
        goal={goal}
        targetRate={targetRate}
        onGoal={() => setSheet({ kind: 'goal' })}
        onRate={() => setSheet({ kind: 'rate' })}
      />

      <button className="settings-link" onClick={() => setScreen('entries')}>
        <Icon name="list" size={20} />
        <span className="grow">Entries</span>
        <Icon name="chevron" size={18} />
      </button>
      {sheets}
    </div>
  )
}
