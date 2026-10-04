import { useEffect, useRef, useState } from 'react'
import {
  type WeightGoal,
} from '../../db'
import { Icon } from '../../components/Icon'
import {
  etaTo,
  fmtFuture,
  fmtLb,
  forecast,
  goalProgress,
  goalDir,
  milestones,
  rates,
  type RateId,
  type TrendPoint,
} from '../../weight'
import { toneFor, reducedMotion, etaText } from './shared'

const RATE_TABS: { id: RateId; label: string; name: string }[] = [
  { id: 'current', label: 'Current', name: 'current' },
  { id: 'overall', label: 'Overall', name: 'overall' },
  { id: 'target', label: 'Target', name: 'target' },
]

/** Animates toward `value` (count up/down) whenever it changes. */
function useTween(value: number | null, ms = 450) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (value == null || from.current == null || reducedMotion()) {
      from.current = value
      setShown(value)
      return
    }
    const a = from.current
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const v = a + (value - a) * (1 - (1 - k) ** 3)
      from.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

function ForecastRow({ weight, whole, label, date, rel }: { weight: number | null; whole?: boolean; label: string; date: string; rel: string }) {
  const w = useTween(weight)
  return (
    <div className="proj-row">
      <div>
        <div className="mono proj-w">
          {w == null ? '—' : whole ? Math.round(w) : fmtLb(w)}
          <span className="muted unit"> lb</span>
        </div>
        <div className="muted small">{label}</div>
      </div>
      <div className="right">
        <div className="proj-date">{date}</div>
        <div className="muted small">{rel}</div>
      </div>
    </div>
  )
}

export function ProjectionsCard({
  pts,
  today,
  goal,
  targetRate,
  onGoal,
  onRate,
}: {
  pts: TrendPoint[]
  today: number
  goal: WeightGoal | undefined
  targetRate: number | undefined
  onGoal: () => void
  onRate: () => void
}) {
  const [sel, setSel] = useState<RateId>('overall')
  const [showAll, setShowAll] = useState(false)
  const all = rates(pts, today, goal, targetRate)
  const slope = all[sel]
  const trend = pts.at(-1)?.trend
  const dir = goal ? goalDir(goal, trend) : 'down'
  const goalW = goal ? Math.round(goal.weight) : null
  const steps = goalW != null && trend != null ? milestones(trend, goalW, dir) : []
  const idx = RATE_TABS.findIndex((t) => t.id === sel)

  const pick = (id: RateId) => {
    if (id === 'target' && (sel === 'target' || targetRate == null)) onRate()
    setSel(id)
  }

  const fc = (days: number) => (slope == null ? null : forecast(pts, slope, days))
  const goalEta = goalW != null ? etaTo(pts, goalW, dir, slope) : null
  const next = steps[0]
  const nextEta = next != null ? etaText(etaTo(pts, next, dir, slope), today) : null
  const prog = goalW != null ? goalProgress(pts, goalW, dir) : null
  const reached = goalEta?.kind === 'reached'

  let line: string
  if (slope != null) line = `At your ${RATE_TABS[idx].name} pace of`
  else if (sel === 'target') line = 'Set a target pace to see where it takes you.'
  else if (pts.length < 2) line = 'Log a few weigh-ins to see a pace.'
  else line = sel === 'overall' ? 'An overall pace needs a week of weigh-ins.' : 'Not enough recent weigh-ins for a current pace.'

  return (
    <section className="card proj-card">
      <h3>Projections</h3>
      <div className="rate-pill" role="group" aria-label="Pace">
        <div className="rate-ind" style={{ transform: `translateX(${idx * 100}%)` }} />
        {RATE_TABS.map((t) => {
          const v = all[t.id]
          const on = t.id === sel
          const tone = on ? (goal ? toneFor(v, goal, pts) : 'text') : ''
          return (
            <button key={t.id} className={on ? 'on' : ''} aria-pressed={on} onClick={() => pick(t.id)}>
              <span className="rate-lbl">
                {t.label}
                {t.id === 'target' && <Icon name="pencil" size={11} width={2.4} />}
              </span>
              <span className={`mono rate-num ${tone}`}>
                {v == null ? (
                  t.id === 'target' ? 'Set' : '—'
                ) : (
                  <>
                    {v !== 0 && <span className="weight-arrow">{v < 0 ? '▼' : '▲'}</span>}
                    {Math.abs(v * 7).toFixed(2)}
                  </>
                )}
              </span>
              <span className="rate-unit">lb / week</span>
            </button>
          )
        })}
      </div>

      <p className="proj-line">
        {line}
        {slope != null && (
          <>
            {' '}
            <span className="mono text">{Math.abs(slope * 7).toFixed(2)}</span> lb / week:
          </>
        )}
      </p>

      {slope != null && trend != null && (
        <>
          <ForecastRow weight={fc(7)} label="7-day forecast" date={fmtFuture(today + 7, today)} rel="in 7 days" />
          <ForecastRow weight={fc(30)} label="30-day forecast" date={fmtFuture(today + 30, today)} rel="in 30 days" />
          {next != null && nextEta && <ForecastRow weight={next} whole label="Next milestone" date={nextEta.date} rel={nextEta.rel} />}
        </>
      )}

      {goalW == null || !prog ? (
        <button className="goal-block goal-set" onClick={onGoal}>
          <Icon name="flag" size={16} />
          <span className="grow">Set a goal</span>
          <Icon name="chevron" size={18} />
        </button>
      ) : (
        <button className="goal-block" onClick={onGoal} aria-label="Edit goal">
          <div className="goal-top">
            <div>
              <div className="goal-kicker">
                <Icon name="flag" size={14} width={2.2} /> Goal
              </div>
              <div className="mono goal-w">
                {goalW}
                <span className="muted unit"> lb</span>
              </div>
            </div>
            <div className="right">
              {(() => {
                const t = goalEta ? etaText(goalEta, today) : { date: '—', rel: '' }
                return (
                  <>
                    <div className={`proj-date ${reached ? 'up' : t.date === '—' || goalEta?.kind === 'far' ? 'muted' : ''}`}>{t.date}</div>
                    <div className="muted small">{t.rel}</div>
                  </>
                )
              })()}
            </div>
          </div>
          <div className="goal-bar">
            <div style={{ width: `${reached ? 100 : prog.pct}%` }} />
          </div>
          <div className="goal-foot muted">
            <span>
              <span className="mono text">{fmtLb(prog.done)}</span> {dir === 'down' ? 'lost' : 'gained'} · {Math.round(reached ? 100 : prog.pct)}%
            </span>
            <span>
              <span className="mono text">{fmtLb(reached ? 0 : prog.toGo)}</span> to go ›
            </span>
          </div>
        </button>
      )}

      {goalW != null && steps.length > 0 && (goalEta?.kind === 'date' || goalEta?.kind === 'far') && (
        <>
          <button className="ms-toggle" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Hide milestones' : 'Show all milestones'}
          </button>
          {showAll && (
            <div className="ms-list">
              {[...steps, goalW].map((w) => {
                const t = etaText(etaTo(pts, w, dir, slope), today)
                return (
                  <div key={w} className="ms-row">
                    <span className="mono">{w}</span>
                    <span>
                      {t.date}
                      {t.rel && <span className="muted"> · {t.rel}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}
