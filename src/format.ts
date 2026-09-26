import type { Exercise, SetEntry } from './db'

export function fmtDuration(sec: number | undefined) {
  if (sec == null || !isFinite(sec)) return '—'
  sec = Math.max(0, Math.round(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtNum(n: number | undefined) {
  if (n == null) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

export function fmtDate(ts: number, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Date(ts).toLocaleDateString(undefined, opts)
}

export function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function daysAgo(ts: number) {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(new Date()) - start(new Date(ts))) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** Compact one-line description of a set. */
export function fmtSet(ex: Pick<Exercise, 'kind' | 'levelLabel'>, s: SetEntry) {
  switch (ex.kind) {
    case 'weight':
      return `${fmtNum(s.weight ?? 0)} × ${s.reps ?? 0}`
    case 'bodyweight':
      if (s.assist) return `Assist ${fmtNum(s.assist)} × ${s.reps ?? 0}`
      return s.weight ? `BW+${fmtNum(s.weight)} × ${s.reps ?? 0}` : `${s.reps ?? 0} reps`
    case 'timed':
      return s.weight ? `${fmtDuration(s.durationSec)} +${fmtNum(s.weight)}` : fmtDuration(s.durationSec)
    case 'cardio': {
      const parts = [fmtDuration(s.durationSec), `${fmtNum(s.speed)} mph`]
      if (s.level != null) parts.push(`${ex.levelLabel?.replace(/ ?%$/, '') || 'Lvl'} ${fmtNum(s.level)}${ex.levelLabel?.endsWith('%') ? '%' : ''}`)
      if (s.calories != null) parts.push(`${fmtNum(s.calories)} cal`)
      return parts.join(' · ')
    }
  }
}

export function parseNum(v: string): number | undefined {
  const t = v.trim()
  if (t === '') return undefined
  const n = Number(t)
  return isFinite(n) ? n : undefined
}

/**
 * "1:30" → 90s, "1:02:03" → 3723s. A bare number uses `bare`:
 * seconds for holds (plank "45"), minutes for cardio (treadmill "30").
 */
export function parseDuration(v: string, bare: 'sec' | 'min' = 'sec'): number | undefined {
  const t = v.trim()
  if (!t) return undefined
  const parts = t.split(':').map((p) => Number(p))
  if (parts.some((p) => !isFinite(p) || p < 0)) return undefined
  if (parts.length === 1) return Math.round(parts[0] * (bare === 'min' ? 60 : 1))
  return Math.round(parts.reduce((acc, p) => acc * 60 + p, 0))
}

/** Inverse of parseDuration for pre-filling inputs. */
export function durationInput(sec: number | undefined) {
  if (sec == null) return ''
  return fmtDuration(sec)
}
