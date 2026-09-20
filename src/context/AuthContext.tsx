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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // 🚨 Explicit redirectTo. Without it the redirect silently falls back
      // to the project's Site URL — which is another app's deployed URL, and
      // it fails with NO error at all: the wrong app simply opens
      // (MIGRATION-LESSONS §2). Proven in my-dream-clean's real deployment.
      //
      // This URL must also be in Supabase's Authentication → URL
      // Configuration → Redirect URLs allow-list, INCLUDING the localhost
      // dev URL, or the same silent fallback happens while testing.
      options: { redirectTo: window.location.href },
    })
    if (error) throw error
    // Redirect-based flow — the browser navigates away; nothing further here.
  }

  const submitEmailAuth: AuthContextValue['submitEmailAuth'] = async (email, password) => {
    if (!email || !password) throw new Error('Enter both an email and a password.')
    if (authMode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.href },
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
      redirectTo: window.location.href,
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
