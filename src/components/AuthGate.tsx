import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import icon from '/apple-touch-icon.png'

/**
 * The sign-in screen. It is the FIRST screen — there is no guest mode and no
 * pre-auth data, by design (MIGRATION-LESSONS §24; see AuthContext).
 *
 * Wording matters here more than usual, because this is where someone finds
 * out that Listly and the ledger share one account. Saying so plainly is
 * cheaper than them making a second account and wondering why nothing is
 * shared.
 */
export function AuthGate() {
  const { authMode, setAuthMode, signInWithGoogle, submitEmailAuth, sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const result = await submitEmailAuth(email, password)
      if (result && 'needsConfirmation' in result && result.needsConfirmation) {
        setNote('Check your email to confirm the account, then sign in.')
      }
    })
  }

  return (
    <div className="app">
      <header>
        <img src={icon} alt="" />
        <div>
          <div className="brand">Listly</div>
          <div className="today">Shopping and jobs, shared</div>
        </div>
      </header>

      <main>
        <div className="stack">
          <div className="card jobform">
            <h2 style={{ margin: 0, fontSize: 32, color: 'var(--brown)' }}>
              {authMode === 'signup' ? 'Create an account' : 'Sign in'}
            </h2>
            <p className="help" style={{ margin: 0 }}>
              Listly uses the same account as Shared Ledger. Sign in with it and you are already in
              the same household — your lists and house jobs will be shared, with nothing to set up.
            </p>

            <button className="btn brown" onClick={() => void run(signInWithGoogle)} disabled={busy}>
              Continue with Google
            </button>

            <div className="help" style={{ textAlign: 'center', margin: '2px 0' }}>or</div>

            <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                className="field"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Email"
                aria-label="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="field"
                type="password"
                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="Password"
                aria-label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="btn sage" type="submit" disabled={busy}>
                {busy ? 'Just a moment…' : authMode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            </form>

            {error && (
              <p className="help" style={{ color: 'var(--red)', margin: 0 }} role="alert">
                {error}
              </p>
            )}
            {note && (
              <p className="help" style={{ color: 'var(--sage)', margin: 0 }}>
                {note}
              </p>
            )}

            <div className="actions">
              <button
                className="btn ghost"
                onClick={() => setAuthMode(authMode === 'signup' ? 'signin' : 'signup')}
                disabled={busy}
              >
                {authMode === 'signup' ? 'I already have an account' : 'Create an account'}
              </button>
              <div style={{ flex: 1 }} />
              {authMode === 'signin' && (
                <button
                  className="btn ghost"
                  onClick={() => void run(() => sendPasswordReset(email).then(() => setNote('Reset email sent.')))}
                  disabled={busy}
                >
                  Forgot password
                </button>
              )}
            </div>
          </div>

          {/* The one-login-per-person assumption, said out loud where it
              matters. My jobs cannot be private if two people share a login,
              and there is no way for the database to tell them apart — the
              link code exists precisely so they do not have to. */}
          <p className="help" style={{ padding: '0 6px' }}>
            You and your partner each need your own account. <b>My jobs</b> is private to whoever is
            signed in, and the household link code is what shares Shopping and House jobs between
            the two of you.
          </p>
        </div>
      </main>
    </div>
  )
}
