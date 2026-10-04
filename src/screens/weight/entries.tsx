import { Icon } from '../../components/Icon'
import {
  dateOf,
  fmtDay,
  fmtLb,
  type TrendPoint,
} from '../../weight'

export function Entries({ pts, today, onBack, onEdit }: { pts: TrendPoint[]; today: number; onBack: () => void; onEdit: (date: string) => void }) {
  const groups: { month: string; rows: { p: TrendPoint; prev?: TrendPoint }[] }[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const month = fmtDay(pts[i].day, { month: 'long', year: 'numeric' })
    if (groups.at(-1)?.month !== month) groups.push({ month, rows: [] })
    groups.at(-1)!.rows.push({ p: pts[i], prev: pts[i - 1] })
  }
  return (
    <div className="weight-entries">
      <button className="btn ghost back" onClick={onBack}>
        <Icon name="back" size={18} /> Weight
      </button>
      <h1>Entries</h1>
      {pts.length === 0 && <p className="muted">Weigh-ins you log show up here.</p>}
      {groups.map((g) => (
        <section key={g.month}>
          <div className="kicker entries-month">{g.month}</div>
          <div className="entries-card">
            {g.rows.map(({ p, prev }) => {
              const d = prev ? p.weight - prev.weight : null
              return (
                <button key={p.day} className="entry-row" onClick={() => onEdit(dateOf(p.day))}>
                  <span className="grow">{p.day === today ? 'Today' : fmtDay(p.day, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span className="mono entry-w">{fmtLb(p.weight)}</span>
                  <span className="mono muted entry-d">{d == null ? '' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmtLb(Math.abs(d))}`}</span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
