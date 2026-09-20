import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AuthGate } from './components/AuthGate'
import { SyncRoot } from './components/SyncRoot'
import { ListlyProvider } from './context/ListlyContext'
import { DueSoonBanners } from './components/DueSoonBanners'
import { BottomNav } from './components/BottomNav'
import { Shopping } from './pages/Shopping'
import { JobsPage } from './pages/JobsPage'
import { AccountModal } from './components/AccountModal'
import { Me } from './components/Icons'
import { SyncStatusDot } from './components/SyncStatusDot'
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
  const [accountOpen, setAccountOpen] = useState(false)

  return (
    <div className="app">
      {/* Brand hard left, account hard right (Adam, 2026-09-20). The date
          that LISTLY-DESIGN.md §5 puts under the wordmark is deliberately
          gone: every screen already says what it is, and the due chips carry
          the only dates that matter. */}
      <header>
        <img src={icon} alt="" />
        <div className="brand grow">Listly</div>
        <SyncStatusDot />
        <button
          className="icon-btn"
          style={{ color: 'var(--brown-2)' }}
          onClick={() => setAccountOpen(true)}
          aria-label="Account and household"
        >
          <Me />
        </button>
      </header>

      <DueSoonBanners />

      {/* The fades are siblings of <main> inside its own wrapper, not
          children of .app: anchored to .app, a top fade would sit over the
          header — which does not scroll — and fade the wrong thing. */}
      <div className="main-wrap">
        <main>
          {tab === 'shopping' && <Shopping />}
          {tab === 'house' && <JobsPage page="house" />}
          {tab === 'mine' && <JobsPage page="mine" />}
        </main>
        <div className="edge-fade edge-fade-top" aria-hidden="true" />
        <div className="edge-fade edge-fade-bottom" aria-hidden="true" />
      </div>

      <BottomNav tab={tab} onChange={setTab} />

      {accountOpen && <AccountModal onClose={() => setAccountOpen(false)} />}
    </div>
  )
}

/**
 * Sign-in is required from the FIRST screen, and there is no guest mode.
 *
 * That is not a product preference: in this stack, signing in for the first
 * time makes all pre-existing local data silently invisible
 * (MIGRATION-LESSONS §24). Listly sidesteps it entirely by never having
 * pre-auth data to lose. Do not add a local-only mode later.
 */
function Gate() {
  const { session } = useAuth()
  // undefined = still checking. Render nothing rather than flashing the
  // sign-in screen at someone who is already signed in.
  if (session === undefined) return null
  if (session === null) return <AuthGate />
  return (
    <SyncRoot>
      <ListlyProvider>
        <Shell />
      </ListlyProvider>
    </SyncRoot>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
