import { useState } from 'react'
import { Today } from './screens/Today'
import { History } from './screens/History'
import { Exercises } from './screens/Exercises'
import { Settings } from './screens/Settings'

type Tab = 'today' | 'history' | 'exercises' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Workout', icon: '🏋️' },
  { id: 'history', label: 'History', icon: '📅' },
  { id: 'exercises', label: 'Exercises', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  // Bumping the key resets a screen (e.g. tapping History again returns to the list).
  const [nonce, setNonce] = useState(0)

  return (
    <div className="app">
      <main className="main" key={`${tab}-${nonce}`}>
        {tab === 'today' && <Today goToSettings={() => setTab('settings')} />}
        {tab === 'history' && <History />}
        {tab === 'exercises' && <Exercises />}
        {tab === 'settings' && <Settings />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'on' : ''}`}
            onClick={() => {
              if (tab === t.id) setNonce(nonce + 1)
              else setTab(t.id)
              window.scrollTo(0, 0)
            }}
          >
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
