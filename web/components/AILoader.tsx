'use client'

interface AILoaderProps {
  title?:    string
  subtitle?: string
  size?:     'sm' | 'md' | 'lg'
}

/**
 * AI-themed loader — pulsing neural node with expanding sonar rings.
 * Drop-in replacement for all loading states across the app.
 */
export default function AILoader({
  title    = 'AI Processing…',
  subtitle,
  size     = 'md',
}: AILoaderProps) {
  const node  = size === 'sm' ? 40 : size === 'lg' ? 96 : 72
  const icon  = Math.round(node * 0.38)
  const inset = Math.round(node * 0.16)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: size === 'sm' ? '1.5rem' : '2.75rem',
      textAlign: 'center',
    }}>
      <style>{`
        @keyframes ai-ring  { 0%   { transform:scale(0.85); opacity:0.9; }
                              100% { transform:scale(2.1);  opacity:0;   } }
        @keyframes ai-pulse { 0%,100% { transform:scale(1);    opacity:1;   }
                              50%     { transform:scale(1.12); opacity:0.8; } }
        @keyframes ai-blink { 0%,80%,100% { transform:scale(0.2); opacity:0.3; }
                              40%          { transform:scale(1);   opacity:1;   } }
        @keyframes ai-scan  { 0%   { stroke-dashoffset:100; opacity:0; }
                              50%  { opacity:1; }
                              100% { stroke-dashoffset:0;   opacity:0; } }
      `}</style>

      {/* ── Neural node ── */}
      <div style={{ position: 'relative', width: node, height: node, marginBottom: '1.1rem' }}>

        {/* Sonar rings */}
        {[0, 0.7, 1.4].map((delay, i) => (
          <div key={i} style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `2px solid #0D9488`,
            animation: `ai-ring 2.1s ease-out ${delay}s infinite`,
          }} />
        ))}

        {/* Core node */}
        <div style={{
          position: 'absolute', inset: inset, borderRadius: '50%',
          background: 'linear-gradient(135deg, #1B3A6B 0%, #0D9488 100%)',
          boxShadow: '0 0 18px rgba(13,148,136,0.45)',
          animation: 'ai-pulse 2s ease-in-out infinite',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Brain / lightbulb icon */}
          <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none"
            stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 1 4 4c0 .34-.04.67-.1 1H16a4 4 0 0 1 0 8h-.5
                     M12 2a4 4 0 0 0-4 4c0 .34.04.67.1 1H8a4 4 0 0 0 0 8h.5
                     M12 6v10m-3 3h6" />
            <circle cx="12" cy="19" r="1" fill="white" stroke="none" />
          </svg>
        </div>
      </div>

      {/* Title */}
      <p style={{
        fontWeight: 700, color: '#1B3A6B',
        fontSize: size === 'sm' ? '0.8rem' : '0.9375rem',
        margin: 0, letterSpacing: '-0.01em',
      }}>{title}</p>

      {/* Subtitle */}
      {subtitle && (
        <p style={{ color: '#64748B', fontSize: '0.775rem', marginTop: 5, marginBottom: 0 }}>
          {subtitle}
        </p>
      )}

      {/* Blinking dots */}
      <div style={{ display: 'flex', gap: 6, marginTop: '0.8rem' }}>
        {[0, 0.2, 0.4].map((delay, i) => (
          <div key={i} style={{
            width: size === 'sm' ? 5 : 7, height: size === 'sm' ? 5 : 7,
            borderRadius: '50%', background: '#0D9488',
            animation: `ai-blink 1.5s ease-in-out ${delay}s infinite`,
          }} />
        ))}
      </div>
    </div>
  )
}

/**
 * Compact inline spinner for buttons — small pulsing dot trio.
 */
export function AISpinner() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 6 }}>
      <style>{`
        @keyframes ai-blink { 0%,80%,100% { transform:scale(0.2); opacity:0.3; }
                              40%          { transform:scale(1);   opacity:1;   } }
      `}</style>
      {[0, 0.18, 0.36].map((delay, i) => (
        <span key={i} style={{
          display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
          background: 'currentColor',
          animation: `ai-blink 1.3s ease-in-out ${delay}s infinite`,
        }} />
      ))}
    </span>
  )
}
