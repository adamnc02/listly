import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import icon from '/apple-touch-icon.png'

/**
 * Google's own mark, in Google's own colours.
 *
 * 🚨 This is the one place Listly's design language is deliberately set
 * aside. A genuine OAuth button has to look like the provider's, because
 * that is what people recognise — a brown handwritten button reading
 * "Google" looks like a phishing attempt, not a sign-in. Same markup as
 * personal-f, my-dream-clean and shared-finance-ledger, so all four apps
 * present the identical control (Adam, 2026-09-20).
 */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.73z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.1C3.24 21.3 7.28 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29v-3.1H1.26A11.96 11.96 0 0 0 0 12c0 1.94.46 3.77 1.26 5.39l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.28 0 3.24 2.7 1.26 6.61l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  )
}

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

            <button className="btn oauth" onClick={() => void run(signInWithGoogle)} disabled={busy}>
              <GoogleIcon />
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
