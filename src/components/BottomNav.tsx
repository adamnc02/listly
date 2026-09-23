import type { Tab } from '../App'
import { Basket, House, Me } from './Icons'

/**
 * Three equal tabs, icon above label, the active one filled brown with
 * white text — the tab-bar rule in src/index.css's header.
 *
 * No router: three tabs with no deep links, no back-button semantics worth
 * having and no URLs to share. `position: fixed` is likewise avoided — the
 * nav is a flex child of the app shell, because fixed positioning is
 * unreliable in iOS standalone mode, which is the mode this app runs in.
 */
export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const button = (id: Tab, icon: React.ReactNode, label: string) => (
    <button onClick={() => onChange(id)} aria-current={tab === id ? 'page' : 'false'}>
      {icon}
      {label}
    </button>
  )

  return (
    <nav>
      {button('shopping', <Basket />, 'Shopping')}
      {button('house', <House />, 'House jobs')}
      {button('mine', <Me />, 'My jobs')}
    </nav>
  )
}
