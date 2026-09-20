import { useEffect, useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { useAuth } from '../context/AuthContext'
import { getLinkCode, regenerateLinkCode, redeemLinkCode, eraseMyData } from '../lib/powersync/linking'

/**
 * Account and household linking.
 *
 * 🚨 THERE IS ONE LINK CODE AND IT BELONGS TO THE HOUSEHOLD, NOT TO AN APP.
 * Every function called here is the ledger's own, unchanged. Listly must
 * never generate a second code, never offer "create a household", and never
 * build a second linking model — so for Adam and Ella there is nothing to do
 * at all: they are already members of one household, and signing into Listly
 * with the same accounts shares Shopping and House jobs immediately.
 *
 * 🚨 LISTLY NEVER OFFERS "SET AS ME". That is `people.linked_user_id`, a
 * LEDGER concept that is meaningless without a `people` row — and a `people`
 * row carries a salary history, a pay cycle, pots and pensions. It is not "a
 * user of this app". Nothing in Listly is keyed on a person: My jobs is keyed
 * on the login itself, and everything else on the household. Creating a
 * `people` row from here would also open the ledger gate for someone with no
 * ledger, which is the exact behaviour Adam asked to prevent.
 *
 * What we show instead is the signed-in email — the honest answer to "who am
 * I in this app", free from the session, and needing no person row. There is
 * deliberately no Listly display name or profile: that would be a third
 * identity model alongside the login and the ledger's person rows.
 */
export function AccountModal({ onClose }: { onClose: () => void }) {
  const { session, signOut } = useAuth()
  const [code, setCode] = useState<string | null>(null)
  const [entry, setEntry] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'regenerate' | 'redeem' | 'erase' | null>(null)

  // Guarded against React StrictMode's double-invoke: two concurrent calls
  // to create_household_link_code() race each other on its unique constraint.
  // linking.ts also retries the loser, so this is belt and braces — but not
  // making the second call at all is better than recovering from it.
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    getLinkCode().then(setCode, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    setNote(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }

  const doRedeem = () =>
    run('redeem', async () => {
      const result = await redeemLinkCode(entry.trim())
      const moved = Object.entries(result.moved ?? {})
        .filter(([k]) => k.startsWith('listly_'))
        .map(([k, v]) => `${v} ${k.replace('listly_', '').replace(/_/g, ' ')}`)
      setNote(
        moved.length
          ? `Joined. Your ${moved.join(', ')} came with you.`
          : 'Joined. Your shopping lists and house jobs stayed with your old household, because someone else is still in it.',
      )
      // 🚨 The household id in memory is now stale, and every open device —
      // including this one — must stop writing with it. A full reload is the
      // bluntest and most reliable way to re-run the boot sequence from
      // ensure_household() (§38).
      setTimeout(() => window.location.reload(), 1800)
    })

  return (
    <Sheet label="Account" onClose={onClose}>
      <h2>Account</h2>

      <div>
        <div className="lbl">Signed in as</div>
        <div className="sub" style={{ fontSize: 22 }}>{session?.user?.email ?? 'Unknown'}</div>
      </div>

      <div>
        <div className="lbl">Your household code</div>
        <p className="help">
          This is the same code Shared Ledger shows — one code for the household, not one per app.
          Give it to the other person and they enter it below.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="field" style={{ letterSpacing: 4, flex: 1, display: 'flex', alignItems: 'center' }}>
            {code ?? '········'}
          </div>
          <button
            className="btn ghost"
            disabled={!code}
            onClick={() => {
              if (code) void navigator.clipboard?.writeText(code).then(() => setNote('Code copied.'))
            }}
          >
            Copy
          </button>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => setConfirm('regenerate')} disabled={busy !== null}>
            Make a new code
          </button>
        </div>
      </div>

      <div>
        <div className="lbl">Join someone else’s household</div>
        {/* 🚨 The one-login-per-person assumption, stated where it actually
            bites (PROMPT-01 §6A.5 asks for it "on the linking screen"). If
            two people shared a login, My jobs would be shared too and there
            would be no way for it not to be — the database has no second
            identity to tell them apart by. The link code exists precisely so
            they do not have to share one. It used to be on the sign-in
            screen; moved here 2026-09-20 (Adam), which is the screen it is
            actually about. */}
        <p className="help">
          You move into their household and see its Shopping and House jobs. <b>My jobs</b> always
          stays yours — you each need your own account for that to work.
        </p>
        <input
          className="field"
          value={entry}
          onChange={(e) => setEntry(e.target.value.toUpperCase())}
          placeholder="8-character code"
          aria-label="Household code"
          autoCapitalize="characters"
          autoCorrect="off"
        />
        <div className="actions">
          <div style={{ flex: 1 }} />
          <button
            className="btn sage"
            disabled={entry.trim().length < 8 || busy !== null}
            onClick={() => setConfirm('redeem')}
          >
            {busy === 'redeem' ? 'Joining…' : 'Join'}
          </button>
        </div>
      </div>

      {note && <p className="help" style={{ color: 'var(--sage)' }}>{note}</p>}
      {error && <p className="help" style={{ color: 'var(--red)' }} role="alert">{error}</p>}

      <div className="actions">
        <button className="btn ghost" onClick={() => void signOut()}>Sign out</button>
        <div style={{ flex: 1 }} />
        <button className="btn danger" onClick={() => setConfirm('erase')} disabled={busy !== null}>
          Delete my app data
        </button>
      </div>

      {confirm && (
        <div className="card" style={{ padding: 14, borderColor: 'var(--red)' }}>
          <div className="lbl" style={{ marginBottom: 6 }}>
            {confirm === 'regenerate' && 'Make a new code?'}
            {confirm === 'redeem' && 'Join this household?'}
            {confirm === 'erase' && 'Delete your Listly data?'}
          </div>
          <p className="help" style={{ marginTop: 0 }}>
            {confirm === 'regenerate' &&
              'The current code stops working straight away, in Listly and in Shared Ledger. Anyone already in your household stays in it.'}
            {confirm === 'redeem' &&
              'If nobody else is left in your current household, your shopping lists and house jobs come with you. If someone else is still in it, they stay behind — they are shared. My jobs always comes with you.'}
            {confirm === 'erase' &&
              'This deletes your Listly data: your private My jobs always, and — if nobody else is in your household — its shopping lists, items, house jobs and shop history too. It also deletes your Shared Ledger data the same way. Your login is kept.'}
          </p>
          <div className="actions">
            <button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <div style={{ flex: 1 }} />
            {confirm === 'regenerate' && (
              <button className="btn brown" onClick={() => void run('code', async () => setCode(await regenerateLinkCode()))}>
                New code
              </button>
            )}
            {confirm === 'redeem' && <button className="btn sage" onClick={() => void doRedeem()}>Join</button>}
            {confirm === 'erase' && (
              <button
                className="btn danger"
                onClick={() =>
                  void run('erase', async () => {
                    await eraseMyData()
                    setNote('Deleted.')
                    setTimeout(() => window.location.reload(), 1200)
                  })
                }
              >
                Delete everything
              </button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}
