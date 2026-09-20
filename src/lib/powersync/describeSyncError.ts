/**
 * Turns PowerSync / OPFS errors into something a person can act on.
 *
 * 🚨 The one that matters. Opening Listly in a SECOND TAB of the same browser
 * fails with:
 *
 *     "The operation failed for an unknown transient reason
 *      (e.g. out of memory)"
 *
 * which is a `DOMException: UnknownError` from the Origin Private File System
 * when another tab already holds the database file. It is not transient, it
 * is not memory, and retrying will never fix it — the message is simply the
 * browser's generic shrug.
 *
 * PowerSync's own default explains why:
 *
 *     // Multiple tabs are by default not supported on Android, iOS and Safari.
 *     enableMultiTabs: … && typeof SharedWorker !== 'undefined'
 *       && !navigator.userAgent.match(/(Android|iPhone|iPod|iPad)/i)
 *       && !window.safari
 *
 * So on Safari and on iOS — Listly's actual target — only one tab can sync at
 * a time. In production that is nearly irrelevant: a Home Screen PWA is a
 * single instance. It bites during desktop testing, which is exactly where it
 * bit (UAT test 7, 2026-09-20).
 *
 * Enabling multi-tab is NOT the fix. It needs a SharedWorker, and Safari is
 * excluded from the default deliberately. Naming the situation is.
 */
export function describeSyncError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()

  if (
    lower.includes('unknown transient reason') ||
    lower.includes('out of memory') ||
    (lower.includes('invalidstateerror') && lower.includes('invalid state'))
  ) {
    return (
      'Listly is probably already open in another tab or window. Only one can sync at a time in ' +
      'this browser. Close the others and reload — on a phone, where Listly runs as a single ' +
      'installed app, this cannot happen.'
    )
  }

  if (lower.includes('sqlite3_open_v2') || lower.includes('failed to open')) {
    return (
      'The on-device database could not be opened. This is usually another tab holding it — close ' +
      'any other Listly tabs and reload.'
    )
  }

  if (lower.includes('load failed') || lower.includes('networkerror') || lower.includes('fetch')) {
    return 'Could not reach the sync service. Listly keeps working offline and will catch up.'
  }

  if (lower.includes('401') || lower.includes('authentication')) {
    return 'The sync service refused the sign-in. Sign out and back in.'
  }

  return message
}

/** True when the error is the "another tab has it" case specifically. */
export function isAnotherTabError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    message.includes('unknown transient reason') ||
    message.includes('out of memory') ||
    message.includes('sqlite3_open_v2')
  )
}
