import { useState } from 'react'
import { Today } from './screens/Today'
import { History } from './screens/History'
import { Progress } from './screens/Progress'
import { Exercises } from './screens/Exercises'
import { Settings } from './screens/Settings'
import { Icon, type IconName } from './components/Icon'

type Tab = 'today' | 'progress' | 'history' | 'exercises' | 'settings'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Log', icon: 'log' },
  { id: 'progress', label: 'Progress', icon: 'progress' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'exercises', label: 'Exercises', icon: 'exercises' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  // Bumping the key resets a screen (e.g. tapping History again returns to the list).
  const [nonce, setNonce] = useState(0)

  return (
    <div className="app">
      <main className="main" key={`${tab}-${nonce}`}>
        {tab === 'today' && <Today goToSettings={() => setTab('settings')} />}
        {tab === 'progress' && <Progress />}
        {tab === 'history' && <History />}
        {tab === 'exercises' && <Exercises />}
        {tab === 'settings' && <Settings />}
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'on' : ''}`}
            aria-label={t.label}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => {
              if (tab === t.id) setNonce(nonce + 1)
              else setTab(t.id)
              window.scrollTo(0, 0)
            }}
          >
            <Icon name={t.icon} />
          </button>
        ))}
      </nav>
    </div>
  )
}
