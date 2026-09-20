import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { clearHouseholdCache } from '../lib/powersync/household'

/**
 * Auth, ported in shape from shared-finance-ledger's AuthContext (itself
 * ported from personal-f), which is the version actually proven in a real
 * deployment.
 *
 * 🚨 SAME Supabase project, SAME `auth.users`. Signing into Listly with the
 * account already used for the ledger puts you in the same household
 * automatically — that is the whole point of D6, and why there is no second
 * link code and no second identity model.
 *
 * Sign-in is required from the first screen and there is no guest mode. That
 * is deliberate: in this stack, signing in for the first time makes all
 * pre-existing local data silently invisible (MIGRATION-LESSONS §24, which
 * cost a family member's data on another app here). Listly avoids it
 * entirely by never having pre-auth data to lose. Do not add a local-only
 * mode later.
 */

interface AuthContextValue {
  /** undefined = not checked yet, null = checked and signed out, Session = signed in.
   *  The shell waits on `undefined` before rendering anything, so a signed-in
   *  user never sees the sign-in screen flash past on load. */
  session: Session | undefined | null
  authMode: 'signin' | 'signup'
  setAuthMode: (mode: 'signin' | 'signup') => void
  signInWithGoogle: () => Promise<void>
  submitEmailAuth: (email: string, password: string) => Promise<{ needsConfirmation: boolean } | void>
  sendPasswordReset: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

/**
 * 🚨 Origin + path ONLY. Never `window.location.href`.
 *
 * Supabase returns the session in the URL **fragment**, so it appends
 * `#access_token=…` to whatever redirect it is given. If the current URL
 * already carries a fragment — which it does the moment ONE sign-in fails
 * and leaves its tokens behind — you get `…/listly/##access_token=…`, and
 * supabase-js's fragment parser reads the leading `#` as part of the first
 * parameter name. `access_token` is then never found, no session is created,
 * the tokens stay in the URL, and the NEXT attempt compounds it. One failure
 * becomes permanent (Adam, 2026-09-20).
 *
 * Passing a clean target makes that impossible, and there is no case where
 * Listly wants to return to a URL carrying a query or fragment: it has no
 * router and exactly one entry point.
 */
function cleanRedirectTarget(): string {
  return window.location.origin + window.location.pathname
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | undefined | null>(undefined)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')

  useEffect(() => {
    // Resolve the current session once, then keep listening. The first
    // onAuthStateChange callback fires with the same session getSession()
    // already returned — a harmless duplicate set.
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.warn('[auth] session check failed:', error.message)
        setSession(null)
        return
      }
      setSession(data.session ?? null)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const signInWithGoogle = async () => {
    // 🚨 Record the attempt BEFORE navigating away. An OAuth round trip
    // destroys the page, so a console.log here is gone by the time it
    // matters and the console does not preserve logs by default. If we come
    // back without a session, AuthGate reads this and can say what redirect
    // was actually requested — which is the single most useful fact when
    // sign-in "does nothing" (MIGRATION-LESSONS §2: three different switches
    // can cause it, and the failure is silent).
    try {
      sessionStorage.setItem(
        'listly:auth:attempt',
        JSON.stringify({ at: new Date().toISOString(), redirectTo: cleanRedirectTarget() }),
      )
    } catch {
      // Private mode. The console warning below is still there.
    }
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // 🚨 Explicit redirectTo. Without it the redirect silently falls back
      // to the project's Site URL — which is another app's deployed URL, and
      // it fails with NO error at all: the wrong app simply opens
      // (MIGRATION-LESSONS §2). Proven in my-dream-clean's real deployment.
      //
      // This URL must also be in Supabase's Authentication → URL
      // Configuration → Redirect URLs allow-list, INCLUDING the localhost
      // dev URL, or the same silent fallback happens while testing.
      options: { redirectTo: cleanRedirectTarget() },
    })
    if (error) {
      console.error('[auth] signInWithOAuth refused:', error)
      throw error
    }
    // Redirect-based flow: supabase-js navigates the browser. If we are still
    // here a moment later, it did NOT — which is a real failure mode worth
    // naming rather than leaving as a button that appears to do nothing.
    console.info('[auth] redirecting to Google:', data?.url)
    setTimeout(() => {
      if (!document.hidden) {
        console.warn('[auth] still on the page after signInWithOAuth — the redirect did not happen.')
      }
    }, 2500)
  }

  const submitEmailAuth: AuthContextValue['submitEmailAuth'] = async (email, password) => {
    if (!email || !password) throw new Error('Enter both an email and a password.')
    if (authMode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: cleanRedirectTarget() },
      })
      if (error) throw error
      if (!data.session) {
        // Email confirmation is on — no session until they confirm.
        setAuthMode('signin')
        return { needsConfirmation: true }
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    }
  }

  const sendPasswordReset = async (email: string) => {
    if (!email) throw new Error('Enter your email above first.')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: cleanRedirectTarget(),
    })
    if (error) throw error
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) console.warn('[auth] sign-out failed:', error.message)
    clearHouseholdCache()
    // onAuthStateChange fires with a null session and the gate reappears.
    // On-device data is left untouched: a sign-out is not a delete.
  }

  return (
    <AuthContext.Provider
      value={{ session, authMode, setAuthMode, signInWithGoogle, submitEmailAuth, sendPasswordReset, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
