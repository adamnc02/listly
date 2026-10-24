import { useCallback, useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AuthGate } from './components/AuthGate'
import { SyncRoot } from './components/SyncRoot'
import { ListlyProvider, useListly } from './context/ListlyContext'
import { DueSoonBanners } from './components/DueSoonBanners'
import { BottomNav } from './components/BottomNav'
import { Shopping } from './pages/Shopping'
import { JobsPage } from './pages/JobsPage'
import { AccountModal } from './components/AccountModal'
import { Me } from './components/Icons'
import { SyncStatusDot } from './components/SyncStatusDot'
import { Rail } from './components/Rail'
import { useRailPages } from './lib/useRailPages'
import { groupKeyOf } from './lib/jobGroups'
import { loadLaptopState, saveLaptopState, type LaptopState } from './lib/laptop'
import { useWide } from './lib/useWide'
import icon from '/apple-touch-icon.png'

export type { Tab } from './lib/openIntent'
import type { Tab } from './lib/openIntent'
import { jobOpenUrl, parseOpen, takePendingOpen } from './lib/openIntent'

/**
 * The app shell: header, due-soon banners, the current tab, the tab bar.
 *
 * The banners sit here rather than on the jobs pages because they show on
 * EVERY tab (TECHNICAL.md §13) — a job due tomorrow needs to reach you
 * while you are looking at the shopping list.
 *
 * The logo is referenced from public/apple-touch-icon.png, not embedded as
 * base64 the way the prototype does it: that data URI is 27KB of the
 * prototype's bulk and it would be carried into every build for no reason
 * (PROMPT-01 §11).
 */
function Shell() {
  const initial = parseOpen(window.location.href, window.location.href)
  const [tab, setTab] = useState<Tab>(() => initial.tab ?? 'shopping')
  // The job whose reminder was tapped, flashed once on its page. `n` makes a
  // second tap on the same job flash again rather than be ignored.
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(() =>
    initial.jobId ? { id: initial.jobId, n: 1 } : null,
  )

  // Where a tapped notification wants to land (src/lib/openIntent.ts). Three
  // ways it can arrive — the URL, the worker's message, the worker's note —
  // because on an iPhone any one of them can be lost.
  // A tapped due-soon banner goes through it too, so a banner and a
  // notification for the same job land in the same place.
  const apply = (url: string) => {
    const o = parseOpen(url, window.location.href)
    if (o.tab) setTab(o.tab)
    if (o.jobId) setFlash((f) => ({ id: o.jobId!, n: (f?.n ?? 0) + 1 }))
  }
  useEffect(() => {
    const fromNote = () => {
      void takePendingOpen().then((url) => url && apply(url))
    }
    // A reload must not re-flash, so the query goes once it has been read.
    if (initial.tab || initial.jobId) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    fromNote()
    const onVisible = () => {
      if (document.visibilityState === 'visible') fromNote()
    }
    document.addEventListener('visibilitychange', onVisible)
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'listly:open' || typeof e.data.url !== 'string') return
      apply(e.data.url)
      fromNote() // the note says the same thing; delete it so it is not applied twice
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The flash is a moment, not a state: gone after it has played.
  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 3200)
    return () => window.clearTimeout(t)
  }, [flash])
  const [accountOpen, setAccountOpen] = useState(false)

  // A household of ONE has no House jobs tab (PROMPT-01 Q11). Exactly one:
  // 0 means the membership has not synced yet, which is "unknown", and
  // hiding the tab on every cold start would make it flicker. If the tab is
  // hidden while showing, Shopping stands in.
  const { householdSize, jobs, jobCategories } = useListly()
  const showHouse = householdSize !== 1
  const shown: Tab = tab === 'house' && !showHouse ? 'shopping' : tab

  // ── The laptop view (TECHNICAL.md §24) ─────────────────────────────────
  // At 768px and wider (and 500px tall, so a sideways phone never counts)
  // the pill becomes a side rail and each page shows the one list picked in
  // it. Below that, everything after this block is unused.
  const wide = useWide()
  const [laptop, setLaptop] = useState<LaptopState>(loadLaptopState)
  useEffect(() => saveLaptopState(laptop), [laptop])
  const pages = useRailPages(laptop, showHouse)

  // Only a pick writes `focus`; what a page SHOWS is resolved from it on
  // every render (lib/laptop.ts resolveFocus), so a list that has not synced
  // yet is not forgotten.
  const focusOn = useCallback((page: Tab, id: string) => {
    setLaptop((s) => (s.focus[page] === id ? s : { ...s, focus: { ...s.focus, [page]: id } }))
  }, [])
  const pick = useCallback(
    (page: Tab, id: string) => {
      setTab(page)
      focusOn(page, id)
    },
    [focusOn],
  )

  // 🚨 A tapped reminder or banner flashes its job's row — and on a laptop
  // only the focused group's rows exist, so the job's group must become the
  // focus or the flash lands on nothing. Same reason, and same shape, as
  // JobsPage opening a collapsed group for it.
  const flashJob = flash ? jobs.find((j) => j.id === flash.id && !j.done) : undefined
  const flashGroup = flashJob ? groupKeyOf(flashJob, jobCategories) : null
  const flashPage = flashJob?.page
  useEffect(() => {
    if (wide && flashPage && flashGroup) focusOn(flashPage, flashGroup)
  }, [wide, flashPage, flashGroup, flash?.n, focusOn])

  if (wide) {
    const focusOf = (page: Tab) => pages.find((p) => p.tab === page)?.focus ?? null
    // The sync dot and the account button: in the phone's header; on a
    // laptop, on the right of each page's title row.
    const extras = (
      <>
        <SyncStatusDot />
        <button
          className="icon-btn"
          style={{ color: 'var(--brown-2)' }}
          onClick={() => setAccountOpen(true)}
          aria-label="Account and household"
        >
          <Me />
        </button>
      </>
    )
    const banner = (page: Tab) => (
      <DueSoonBanners onOpen={(job) => apply(jobOpenUrl(job))} focusKey={focusOf(page)} />
    )
    return (
      <div className="app wide">
        <Rail
          pages={pages}
          tab={shown}
          collapsed={laptop.railCollapsed}
          railOpen={laptop.railOpen}
          onTab={setTab}
          onPick={pick}
          onToggleOpen={(page) =>
            setLaptop((s) => ({ ...s, railOpen: { ...s.railOpen, [page]: !(s.railOpen[page] ?? page === shown) } }))
          }
          onToggleRail={() => setLaptop((s) => ({ ...s, railCollapsed: !s.railCollapsed }))}
        />
        <div className="main-wrap">
          <main>
            {shown === 'shopping' && <Shopping laptop={{ focusId: focusOf('shopping'), extras }} />}
            {shown === 'house' && (
              <JobsPage
                page="house"
                flashJobId={flash?.id ?? null}
                flashKey={flash?.n ?? 0}
                laptop={{ focusKey: focusOf('house'), extras, banner: banner('house') }}
              />
            )}
            {shown === 'mine' && (
              <JobsPage
                page="mine"
                flashJobId={flash?.id ?? null}
                flashKey={flash?.n ?? 0}
                laptop={{ focusKey: focusOf('mine'), extras, banner: banner('mine') }}
              />
            )}
          </main>
          <div className="edge-fade edge-fade-top" aria-hidden="true" />
          <div className="edge-fade edge-fade-bottom" aria-hidden="true" />
        </div>
        {accountOpen && <AccountModal onClose={() => setAccountOpen(false)} />}
      </div>
    )
  }

  return (
    <div className="app">
      {/* Brand hard left, account hard right (Adam, 2026-09-20). The date
          the original design put under the wordmark is deliberately gone:
          every screen already says what it is, and the due chips carry the
          only dates that matter. */}
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

      <DueSoonBanners onOpen={(job) => apply(jobOpenUrl(job))} />

      {/* The fades are siblings of <main> inside its own wrapper, not
          children of .app: anchored to .app, a top fade would sit over the
          header — which does not scroll — and fade the wrong thing. */}
      <div className="main-wrap">
        <main>
          {shown === 'shopping' && <Shopping />}
          {shown === 'house' && <JobsPage page="house" flashJobId={flash?.id ?? null} flashKey={flash?.n ?? 0} />}
          {shown === 'mine' && <JobsPage page="mine" flashJobId={flash?.id ?? null} flashKey={flash?.n ?? 0} />}
        </main>
        <div className="edge-fade edge-fade-top" aria-hidden="true" />
        <div className="edge-fade edge-fade-bottom" aria-hidden="true" />
      </div>

      <BottomNav tab={shown} onChange={setTab} showHouse={showHouse} />

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
