'use client'
import { useState, useEffect } from 'react'

const SESSION_KEY = 'finnup_auth'
const CORRECT_USER = 'admin'
const CORRECT_PASS = 'admin@12ka4'

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed]   = useState<boolean | null>(null)
  const [user, setUser]       = useState('')
  const [pass, setPass]       = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError]     = useState('')
  const [shaking, setShaking] = useState(false)

  useEffect(() => {
    setAuthed(sessionStorage.getItem(SESSION_KEY) === '1')
  }, [])

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (user === CORRECT_USER && pass === CORRECT_PASS) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setAuthed(true)
    } else {
      setError('Invalid username or password')
      setShaking(true)
      setTimeout(() => setShaking(false), 500)
    }
  }

  function handleSignOut() {
    sessionStorage.removeItem(SESSION_KEY)
    setPass('')
    setError('')
    setAuthed(false)
  }

  // Still checking sessionStorage
  if (authed === null) return null

  if (authed) {
    return (
      <>
        <button
          type="button"
          onClick={handleSignOut}
          style={{
            position: 'fixed',
            top: 18,
            right: 18,
            zIndex: 1000,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '0.625rem 0.9rem',
            borderRadius: '9999px',
            border: '1px solid rgba(15,23,42,0.08)',
            background: 'rgba(255,255,255,0.92)',
            color: '#0F172A',
            fontSize: '0.78rem',
            fontWeight: 700,
            boxShadow: '0 10px 30px rgba(15,23,42,0.12)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            cursor: 'pointer',
          }}
        >
          <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1" />
          </svg>
          Sign out
        </button>
        {children}
      </>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f1f3d 0%, #1B3A6B 45%, #0D9488 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
    }}>
      {/* Decorative blobs */}
      <div style={{ position: 'fixed', top: '-10%', right: '-5%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(13,148,136,0.15)', filter: 'blur(80px)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '-10%', left: '-5%', width: 350, height: 350, borderRadius: '50%', background: 'rgba(27,58,107,0.3)', filter: 'blur(80px)', pointerEvents: 'none' }} />

      <div style={{
        width: '100%',
        maxWidth: 420,
        animation: shaking ? 'shake 0.4s ease' : undefined,
      }}>
        {/* Logo / brand */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, borderRadius: '1.25rem',
            background: 'linear-gradient(135deg,#0D9488,#059669)',
            boxShadow: '0 8px 32px rgba(13,148,136,0.4)',
            marginBottom: '1rem',
          }}>
            <svg style={{ width: 32, height: 32, color: 'white' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.02em' }}>
            Finn<span style={{ color: '#5EEAD4' }}>Up</span>
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.825rem', marginTop: '0.375rem' }}>
            MSME Lender Matching · APAL Cohort 2
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '1.25rem',
          padding: '2rem',
          boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
        }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'white', marginBottom: '0.25rem' }}>Sign in</h2>
          <p style={{ fontSize: '0.775rem', color: 'rgba(255,255,255,0.45)', marginBottom: '1.5rem' }}>
            Access restricted — authorised users only
          </p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Username */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.65)', marginBottom: '0.375rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Username
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)' }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={user}
                  onChange={e => { setUser(e.target.value); setError('') }}
                  placeholder="Enter username"
                  autoComplete="username"
                  style={{
                    width: '100%', paddingLeft: 38, paddingRight: 14, paddingTop: 10, paddingBottom: 10,
                    background: 'rgba(255,255,255,0.08)', border: `1.5px solid ${error ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: '0.625rem', color: 'white', fontSize: '0.875rem',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#5EEAD4')}
                  onBlur={e => (e.target.style.borderColor = error ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)')}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255,255,255,0.65)', marginBottom: '0.375rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)' }}>
                  <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={pass}
                  onChange={e => { setPass(e.target.value); setError('') }}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  style={{
                    width: '100%', paddingLeft: 38, paddingRight: 42, paddingTop: 10, paddingBottom: 10,
                    background: 'rgba(255,255,255,0.08)', border: `1.5px solid ${error ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: '0.625rem', color: 'white', fontSize: '0.875rem',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#5EEAD4')}
                  onBlur={e => (e.target.style.borderColor = error ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)')}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 0 }}
                >
                  {showPass
                    ? <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    : <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  }
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                <svg style={{ width: 14, height: 14, color: '#FCA5A5', flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span style={{ fontSize: '0.775rem', color: '#FCA5A5' }}>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              style={{
                width: '100%', padding: '0.75rem',
                background: 'linear-gradient(135deg,#0D9488,#059669)',
                border: 'none', borderRadius: '0.625rem',
                color: 'white', fontSize: '0.875rem', fontWeight: 700,
                cursor: 'pointer', marginTop: '0.25rem',
                boxShadow: '0 4px 16px rgba(13,148,136,0.35)',
                transition: 'opacity 150ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              Sign in →
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', marginTop: '1.5rem' }}>
          IIM Calcutta · APAL Cohort 2 · Group 1 · FinnUp © 2026
        </p>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-8px); }
          40%       { transform: translateX(8px); }
          60%       { transform: translateX(-6px); }
          80%       { transform: translateX(6px); }
        }
        input::placeholder { color: rgba(255,255,255,0.25); }
        input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 100px rgba(27,58,107,0.9) inset !important;
          -webkit-text-fill-color: white !important;
        }
      `}</style>
    </div>
  )
}
