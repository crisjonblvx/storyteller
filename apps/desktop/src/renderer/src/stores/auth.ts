import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '@renderer/lib/supabase'

interface AuthState {
  user: User | null
  demo: boolean
  loading: boolean
  init: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signUp: (email: string, password: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  enterDemo: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  demo: false,
  loading: true,
  init: async () => {
    if (!supabaseConfigured || !supabase) {
      set({ loading: false, user: null, demo: false })
      return
    }
    const { data } = await supabase.auth.getSession()
    set({ user: data.session?.user ?? null, loading: false, demo: false })
    supabase.auth.onAuthStateChange((_e, session) => {
      set({ user: session?.user ?? null, demo: false })
    })
  },
  signIn: async (email, password) => {
    if (!supabase) return { error: 'Supabase not configured' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? { error: error.message } : {}
  },
  signUp: async (email, password) => {
    if (!supabase) return { error: 'Supabase not configured' }
    const { error } = await supabase.auth.signUp({ email, password })
    return error ? { error: error.message } : {}
  },
  signOut: async () => {
    if (get().demo) {
      set({ user: null, demo: false })
      return
    }
    if (supabase) await supabase.auth.signOut()
    set({ user: null })
  },
  enterDemo: () =>
    set({
      demo: true,
      /**
       * Use a deterministic but RFC4122-shaped UUID so any write that escapes
       * to Supabase fails for an honest RLS reason rather than a parse error.
       * Combined with the `demo` flag, downstream code routes around cloud.
       */
      user: { id: '00000000-0000-4000-8000-00000000d3e0', email: 'demo@storyteller.local' } as User,
      loading: false
    })
}))
