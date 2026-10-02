import type { Tab } from '../App'
import { Basket, CheckSquare, House } from './Icons'

/**
 * Equal tabs — three, or two in a household of one — icon above label, the active one filled brown with
 * white text — the tab-bar rule in src/index.css's header.
 *
 * No router: three tabs with no deep links, no back-button semantics worth
 * having and no URLs to share.
 *
 * `position: fixed` is avoided, because it is unreliable in iOS standalone
 * mode — the mode this app runs in. The pill is `position: absolute`, anchored
 * to `.app` against the JS-measured --app-height (src/index.css, "tab bar").
 * It is NOT a flex child of the shell, as this comment used to say.
 *
 * It renders nothing while the on-screen keyboard is up: index.html sets
 * data-keyboard="open" on <html> and the CSS hides the pill. There is no prop
 * and no state for it here — being out of the flow is what makes that free.
 */
export function BottomNav({ tab, onChange, showHouse }: { tab: Tab; onChange: (t: Tab) => void; showHouse: boolean }) {
  const button = (id: Tab, icon: React.ReactNode, label: string) => (
    <button onClick={() => onChange(id)} aria-current={tab === id ? 'page' : 'false'}>
      {icon}
      {label}
    </button>
  )

  return (
    <nav>
      {button('shopping', <Basket />, 'Shopping')}
      {/* Hidden for a household of one (PROMPT-01 Q11): nobody to share with. */}
      {showHouse && button('house', <House />, 'House jobs')}
      {button('mine', <CheckSquare />, 'To-Do')}
    </nav>
  )
}
