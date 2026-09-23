/**
 * What to do with this device's local database when someone signs in.
 * Pure, so scripts/verify-account-switch.ts can prove it. SyncRoot acts on it.
 *
 * 🚨 Adam, 2026-09-21: "When switching account, the old list remains". The
 * rule, ported from shared-finance-ledger: a DIFFERENT account from the last
 * one on this device → clear the local database before anything reads it, so
 * nobody is ever shown another account's lists or private My jobs.
 *
 *   'keep'  — the same account as last time: its data, including anything not
 *             yet uploaded, stays and carries on syncing.
 *   'clear' — a different account (or unknown, with nothing to lose).
 *   'adopt' — nobody recorded yet (the first launch after this shipped) AND
 *             changes are waiting to upload: clearing would throw them away,
 *             so this once the data is kept and the user recorded.
 */
export type AccountSwitch = 'keep' | 'clear' | 'adopt'

export function accountSwitch(previousUser: string | null, userId: string, waiting: number): AccountSwitch {
  if (previousUser === userId) return 'keep'
  if (previousUser === null && waiting > 0) return 'adopt'
  return 'clear'
}
