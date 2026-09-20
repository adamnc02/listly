import { useEffect, useState, type FormEvent } from 'react'
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

  /**
   * 🚨 Report a failed OAuth round trip instead of silently returning to the
   * sign-in screen.
   *
   * Adam, 2026-09-20: "the new continue with google button does nothing, the
   * app flashes and remains on the login screen" — with NOTHING in the
   * console. That is the shape of every failure MIGRATION-LESSONS §2
   * describes: three independent switches (the Supabase provider, the Google
   * Cloud client's Authorized redirect URIs, and Supabase's own Redirect URLs
   * allow-list) can each cause it, and the allow-list one in particular
   * fails with NO error at all — Supabase just quietly substitutes the
   * project's Site URL.
   *
   * So: if the provider handed back an error in the URL, show it. And if we
   * returned from an attempt with no session and no error, say that too,
   * along with the redirect that was actually requested.
   */
  useEffect(() => {
    const params = new URLSearchParams(
      window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.search,
    )
    // 🚨 If a token fragment is sitting here, supabase-js has already had its
    // chance to consume it (detectSessionInUrl runs when the client is
    // created, before this component mounts). Still being on the sign-in
    // screen means it did not take. Clear it: left in place it becomes the
    // next redirectTo, producing `##access_token=` — a double hash that
    // breaks the fragment parser permanently — and it is a live credential
    // sitting in the address bar and in history.
    if (window.location.hash.includes('access_token')) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    const oauthError = params.get('error_description') ?? params.get('error')
    if (oauthError) {
      setError(`Sign-in was refused: ${oauthError}`)
      // Clear it so a reload does not keep showing a stale failure.
      window.history.replaceState({}, '', window.location.pathname)
      try { sessionStorage.removeItem('listly:auth:attempt') } catch { /* private mode */ }
      return
    }
    try {
      const raw = sessionStorage.getItem('listly:auth:attempt')
      if (!raw) return
      sessionStorage.removeItem('listly:auth:attempt')
      JSON.parse(raw)
      // Back on the sign-in screen after an attempt = no session was created.
      //
      // 🚨 Deliberately does NOT print the URL. A failed OAuth return leaves
      // a live access_token AND refresh_token in the fragment, and this
      // message is the kind of thing people screenshot and paste into a chat
      // — which is exactly what happened on 2026-09-20. Say what to check,
      // never the credential.
      setError(
        'Sign-in came back without creating a session. Check that this app\u2019s address — ' +
          'origin and path, e.g. http://localhost:5173/listly/** — is in Supabase \u2192 ' +
          'Authentication \u2192 URL Configuration \u2192 Redirect URLs.',
      )
    } catch {
      // Private mode, or unparseable. Nothing to report.
    }
  }, [])

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
        <div className="brand grow">Listly</div>
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

        </div>
      </main>
    </div>
  )
}
