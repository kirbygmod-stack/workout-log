import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db, exportData, getMeta, importData, setMeta, type BackupFile } from '../db'
import { daysAgo, fmtDate } from '../format'
import { Icon } from '../components/Icon'
import { History } from './History'

export function Settings() {
  const [showHistory, setShowHistory] = useState(false)
  const stats = useLiveQuery(async () => ({
    workouts: await db.workouts.count(),
    sets: await db.sets.count(),
    exercises: await db.exercises.count(),
    lastBackup: await getMeta<number>('lastBackupAt'),
  }))
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])

  const doExport = async () => {
    setMsg('')
    const data = await exportData()
    const name = `workout-log-backup-${new Date().toISOString().slice(0, 10)}.json`
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' })
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Workout Log backup' })
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }
      await setMeta('lastBackupAt', Date.now())
      setMsg('Backup created. Save it to Files → iCloud Drive.')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMsg(`Backup failed: ${(e as Error).message}`)
    }
  }

  const doImport = async (f: File) => {
    setMsg('')
    try {
      const data = JSON.parse(await f.text()) as BackupFile
      const summary = `${data.workouts?.length ?? 0} workouts from ${data.exportedAt ? fmtDate(Date.parse(data.exportedAt)) : 'unknown date'}`
      if (!confirm(`Restore ${summary}? This REPLACES everything currently in the app.`)) return
      await importData(data)
      setMsg('Restored.')
    } catch (e) {
      setMsg(`Restore failed: ${(e as Error).message}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (showHistory) return <History onBack={() => setShowHistory(false)} />

  return (
    <div>
      <h1>Settings</h1>

      <section className="card">
        <h3>Backup</h3>
        <p className="muted small">
          Your data lives only on this phone. Back up regularly and save the file to iCloud Drive.
          {stats && (
            <>
              <br />
              Last backup: {stats.lastBackup ? `${fmtDate(stats.lastBackup)} (${daysAgo(stats.lastBackup)})` : 'never'}
            </>
          )}
        </p>
        <div className="row gap">
          <button className="btn primary grow" onClick={doExport}>
            Back up now
          </button>
          <button className="btn grow" onClick={() => fileRef.current?.click()}>
            Restore…
          </button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        {msg && <p className="small">{msg}</p>}
      </section>

      <section className="card">
        <h3>Storage</h3>
        {stats && (
          <p className="muted small">
            {stats.workouts} workouts · {stats.sets} sets · {stats.exercises} exercises
          </p>
        )}
        <p className="muted small">
          {persisted === true && 'Storage is marked persistent — iOS won’t clear it.'}
          {persisted === false && 'Storage isn’t marked persistent yet. Add the app to your Home Screen and open it from there.'}
          {persisted === null && 'Persistent storage status unavailable.'}
        </p>
      </section>

      <button className="settings-link" onClick={() => setShowHistory(true)}>
        <Icon name="history" size={20} />
        <span className="grow">History</span>
        <Icon name="chevron" size={18} />
      </button>

      <p className="muted small center footnote">Workout Log v2 · all weights in lbs</p>
    </div>
  )
}
