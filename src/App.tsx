import { useState } from 'react'
import { ListlyProvider } from './context/ListlyContext'
import { DueSoonBanners } from './components/DueSoonBanners'
import { BottomNav } from './components/BottomNav'
import { Shopping } from './pages/Shopping'
import { JobsPage } from './pages/JobsPage'
import { todayLong } from './lib/jobs'
import icon from '/apple-touch-icon.png'

export type Tab = 'shopping' | 'house' | 'mine'

/**
 * The app shell: header, due-soon banners, the current tab, the tab bar.
 *
 * The banners sit here rather than on the jobs pages because they show on
 * EVERY tab (LISTLY-DESIGN.md §4) — a job due tomorrow needs to reach you
 * while you are looking at the shopping list.
 *
 * The logo is referenced from public/apple-touch-icon.png, not embedded as
 * base64 the way the prototype does it: that data URI is 27KB of the
 * prototype's bulk and it would be carried into every build for no reason
 * (PROMPT-01 §11).
 */
function Shell() {
  const [tab, setTab] = useState<Tab>('shopping')

  return (
    <div className="app">
      <header>
        <img src={icon} alt="" />
        <div>
          <div className="brand">Listly</div>
          <div className="today">{todayLong()}</div>
        </div>
      </header>

      <DueSoonBanners />

      <main>
        {tab === 'shopping' && <Shopping />}
        {tab === 'house' && <JobsPage page="house" />}
        {tab === 'mine' && <JobsPage page="mine" />}
      </main>

      <BottomNav tab={tab} onChange={setTab} />
    </div>
  )
}

export default function App() {
  return (
    <ListlyProvider>
      <Shell />
    </ListlyProvider>
  )
}
