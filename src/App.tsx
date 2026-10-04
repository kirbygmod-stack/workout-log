import { useState } from 'react'
import { Today } from './screens/Today'
import { Progress } from './screens/Progress'
import { Weight } from './screens/Weight'
import { Exercises } from './screens/Exercises'
import { Settings } from './screens/Settings'
import { Icon, type IconName } from './components/Icon'
import { scrollToTop } from './scroller'

type Tab = 'today' | 'progress' | 'weight' | 'exercises' | 'settings'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Log', icon: 'log' },
  { id: 'progress', label: 'Progress', icon: 'progress' },
  { id: 'weight', label: 'Weight', icon: 'weight' },
  { id: 'exercises', label: 'Exercises', icon: 'exercises' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  // Bumping the key resets a screen (e.g. tapping Settings again leaves History).
  const [nonce, setNonce] = useState(0)

  return (
    <div className="app">
      <div className="scroller">
        <main className="main" key={`${tab}-${nonce}`}>
          {tab === 'today' && <Today goToSettings={() => setTab('settings')} />}
          {tab === 'progress' && <Progress />}
          {tab === 'weight' && <Weight />}
          {tab === 'exercises' && <Exercises />}
          {tab === 'settings' && <Settings />}
        </main>
      </div>
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
              scrollToTop()
            }}
          >
            <Icon name={t.icon} />
          </button>
        ))}
      </nav>
    </div>
  )
}
