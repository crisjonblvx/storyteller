import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@renderer/stores/auth'
import { supabaseConfigured } from '@renderer/lib/supabase'
import { SystemStatusBar } from '@renderer/components/SystemStatusBar'

export function LoginPage() {
  const navigate = useNavigate()
  const { signIn, signUp, enterDemo } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const fn = mode === 'signin' ? signIn : signUp
    const res = await fn(email, password)
    if (res.error) setError(res.error)
    else navigate('/')
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 32
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 28
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 24, letterSpacing: '-0.02em' }}>Storyteller</h1>
        <p style={{ margin: '0 0 24px', color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>
          Sign in with Supabase (email/password). Magic links can be enabled in the Supabase dashboard.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setMode('signin')}
            style={tabBtn(mode === 'signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            style={tabBtn(mode === 'signup')}
          >
            Create account
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <label style={label}>Email</label>
          <input
            style={input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
          />
          <label style={label}>Password</label>
          <input
            style={input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
          />
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>{error}</p>
          )}
          <button type="submit" style={primaryBtn}>
            {mode === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        </form>
        {!supabaseConfigured && (
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>
            Cloud accounts are not enabled in this build. You can still use Storyteller offline.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            enterDemo()
            navigate('/')
          }}
          style={{ ...ghostBtn, width: '100%', marginTop: 12 }}
        >
          Continue without account (local demo)
        </button>
        <div style={{ marginTop: 18 }}>
          <SystemStatusBar />
        </div>
      </div>
    </div>
  )
}

const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }
const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-panel)',
  color: 'var(--text)',
  marginBottom: 14,
  outline: 'none'
}
const primaryBtn: React.CSSProperties = {
  width: '100%',
  marginTop: 8,
  padding: '12px 14px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-dim) 100%)',
  color: '#061210',
  fontWeight: 600,
  fontSize: 14
}
const ghostBtn: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 13
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '8px 10px',
    borderRadius: 8,
    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
    background: active ? 'rgba(110,231,197,0.08)' : 'transparent',
    color: 'var(--text)',
    fontSize: 13
  }
}
