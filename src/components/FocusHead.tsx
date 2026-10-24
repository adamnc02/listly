import type { ReactNode } from 'react'
import { StarFilled } from './Icons'

/**
 * The laptop view's page title (TECHNICAL.md §24): the page's name small
 * above, the focused list's name as the heading, its count, then the page's
 * own buttons and the shell's (sync dot, account) on the right. On a phone
 * the header carries the sync dot and account; on a laptop the rail has no
 * room for them, so they sit here.
 */
export function FocusHead({
  page, title, isDefault = false, count, children,
}: {
  page: string
  title: string
  isDefault?: boolean
  count?: string
  children: ReactNode
}) {
  return (
    <div className="focushead">
      <div className="grow">
        <div className="eyebrow">{page}</div>
        <h1>
          {title}
          {isDefault && (
            <span className="defmark" title="Default list">
              <StarFilled size={20} />
              <span className="sr">Default list</span>
            </span>
          )}
          {count && <span className="pill">{count}</span>}
        </h1>
      </div>
      {children}
    </div>
  )
}
