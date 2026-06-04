'use client'
import { useEffect, useState, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface LenderPolicy {
  lender_name: string
  product_name: string | null
  entity_types: string | null
  loan_min: number | null
  loan_max: number | null
  cibil_min: number | null
  vintage_min: number | null
  overdue_max: number | null
  dpd90_max: number | null
  suit_max: number | null
  inward_bounce_max: number | null
  enq30_max: number | null
  raw: Record<string, string | number>
}

interface LendersResponse {
  lenders: LenderPolicy[]
  total: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(v: number | null, unit = '') {
  if (v === null || v === undefined) return <span style={{ color: '#CBD5E1' }}>—</span>
  return <>{v.toLocaleString('en-IN')}{unit && <span style={{ fontSize: '0.65em', marginLeft: 2, opacity: 0.75 }}>{unit}</span>}</>
}

function fmtLakhs(v: number | null) {
  if (v === null || v === undefined) return <span style={{ color: '#CBD5E1' }}>—</span>
  const l = v / 100_000
  return <>{l >= 100 ? `${(l / 100).toFixed(0)} Cr` : `${l.toFixed(0)} L`}</>
}

/** Compute a 0-1 "strictness" score for sorting/colouring.
 *  Higher = more demanding (tighter CIBIL, higher vintage, etc.) */
function strictness(l: LenderPolicy): number {
  let s = 0; let n = 0
  if (l.cibil_min !== null)        { s += (l.cibil_min - 600) / 250; n++ }  // 600-850 range
  if (l.vintage_min !== null)      { s += Math.min(l.vintage_min / 60, 1); n++ }  // 0-60mo
  if (l.dpd90_max !== null)        { s += l.dpd90_max === 0 ? 1 : 0.5; n++ }
  if (l.suit_max !== null)         { s += l.suit_max === 0 ? 1 : 0.3; n++ }
  if (l.overdue_max !== null)      { s += l.overdue_max === 0 ? 1 : 0.3; n++ }
  if (l.inward_bounce_max !== null){ s += Math.max(0, 1 - l.inward_bounce_max / 5); n++ }
  if (l.enq30_max !== null)        { s += Math.max(0, 1 - l.enq30_max / 5); n++ }
  return n > 0 ? s / n : 0.5
}

function StrictnessBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = pct >= 70 ? '#EF4444' : pct >= 40 ? '#F59E0B' : '#16A34A'
  const label = pct >= 70 ? 'Strict' : pct >= 40 ? 'Moderate' : 'Lenient'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Policy Strictness</span>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color }}>{label}</span>
      </div>
      <div style={{ height: 4, background: '#E2E8F0', borderRadius: 9999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 9999, transition: 'width 300ms' }} />
      </div>
    </div>
  )
}

function PolicyRow({ icon, label, value, type, desc }: {
  icon: string; label: string; value: React.ReactNode; type: 'min' | 'max' | 'range'; desc?: string
}) {
  const badgeColor = type === 'min'
    ? { bg: '#EFF6FF', text: '#1D4ED8' }
    : type === 'max'
      ? { bg: '#FEF2F2', text: '#DC2626' }
      : { bg: '#F0FDFA', text: '#0F766E' }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.375rem 0', borderBottom: '1px solid #F8FAFC' }}>
      <span style={{ fontSize: '0.875rem', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '0.7rem', color: '#64748B' }}>{label}</span>
        {desc && <p style={{ fontSize: '0.62rem', color: '#94A3B8', margin: 0, lineHeight: 1.4 }}>{desc}</p>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1B3A6B' }}>{value}</div>
        <span style={{ fontSize: '0.6rem', padding: '0 5px', borderRadius: 3, background: badgeColor.bg, color: badgeColor.text, fontWeight: 700 }}>
          {type === 'min' ? 'min required' : type === 'max' ? 'max allowed' : 'range'}
        </span>
      </div>
    </div>
  )
}

function RawTable({ raw }: { raw: Record<string, string | number> }) {
  const entries = Object.entries(raw).filter(([k]) => k !== 'lender_name')
  return (
    <div style={{ overflowX: 'auto', marginTop: '0.625rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
        <thead>
          <tr style={{ background: '#F1F5F9' }}>
            <th style={{ padding: '0.375rem 0.625rem', textAlign: 'left', color: '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>Column</th>
            <th style={{ padding: '0.375rem 0.625rem', textAlign: 'right', color: '#475569', fontWeight: 700 }}>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ padding: '0.3rem 0.625rem', color: '#64748B', fontFamily: 'monospace' }}>{k}</td>
              <td style={{ padding: '0.3rem 0.625rem', textAlign: 'right', color: '#1B3A6B', fontWeight: 500 }}>{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Lender Card ───────────────────────────────────────────────────────────────
function LenderCard({ l, index }: { l: LenderPolicy; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const strict = strictness(l)

  return (
    <div style={{
      background: 'white', borderRadius: '1rem', border: '1px solid #E2E8F0',
      overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      transition: 'box-shadow 150ms',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.09)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)' }}
    >
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#1B3A6B 0%,#234785 100%)', padding: '0.875rem 1.125rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            Lender #{index + 1}
          </div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 800, color: 'white', lineHeight: 1.2, wordBreak: 'break-word' }}>
            {l.lender_name}
          </div>
          {l.product_name && (
            <div style={{ marginTop: 5 }}>
              <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)', padding: '2px 8px', borderRadius: 9999, fontWeight: 600 }}>
                {l.product_name}
              </span>
            </div>
          )}
        </div>
        {/* Loan range badge */}
        {(l.loan_min !== null || l.loan_max !== null) && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Loan Range</div>
            <div style={{ fontSize: '0.875rem', fontWeight: 800, color: 'white' }}>
              {l.loan_min !== null ? <>{(l.loan_min / 100_000).toFixed(0)}L</> : '—'}
              {' – '}
              {l.loan_max !== null ? <>{l.loan_max >= 10_000_000 ? `${(l.loan_max / 10_000_000).toFixed(0)} Cr` : `${(l.loan_max / 100_000).toFixed(0)}L`}</> : '—'}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '0.875rem 1.125rem', display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>

        <StrictnessBar score={strict} />

        <div style={{ marginTop: '0.625rem' }}>
          {l.cibil_min !== null && (
            <PolicyRow icon="💳" label="CIBIL Score" value={fmt(l.cibil_min)} type="min"
              desc="Minimum credit score required for eligibility" />
          )}
          {l.vintage_min !== null && (
            <PolicyRow icon="📅" label="Business Vintage" value={<>{fmt(l.vintage_min)} <span style={{ fontSize: '0.7em' }}>months</span></>} type="min"
              desc="Minimum months since business incorporation" />
          )}
          {l.dpd90_max !== null && (
            <PolicyRow icon="⚠️" label="DPD 90+ (last 12 mo)" value={fmt(l.dpd90_max)} type="max"
              desc="Max payments > 90 days overdue allowed" />
          )}
          {l.overdue_max !== null && (
            <PolicyRow icon="🔴" label="Overdue Accounts" value={fmt(l.overdue_max)} type="max"
              desc="Maximum overdue accounts permitted" />
          )}
          {l.suit_max !== null && (
            <PolicyRow icon="⚖️" label="Suit Filed" value={fmt(l.suit_max)} type="max"
              desc="Maximum legal suits filed allowed" />
          )}
          {l.inward_bounce_max !== null && (
            <PolicyRow icon="↩️" label="Inward Cheque Bounces" value={fmt(l.inward_bounce_max)} type="max"
              desc="Max inward bounces allowed" />
          )}
          {l.enq30_max !== null && (
            <PolicyRow icon="🔍" label="Enquiries (30 days)" value={fmt(l.enq30_max)} type="max"
              desc="Max credit bureau enquiries in last 30 days" />
          )}
          {l.entity_types && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.375rem 0', borderBottom: '1px solid #F8FAFC' }}>
              <span style={{ fontSize: '0.875rem', flexShrink: 0 }}>🏢</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.7rem', color: '#64748B' }}>Eligible Entity Types</span>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.72rem', fontWeight: 600, color: '#0D9488', maxWidth: '55%', lineHeight: 1.4 }}>
                {l.entity_types}
              </div>
            </div>
          )}
        </div>

        {/* Expand raw columns */}
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            marginTop: '0.625rem', width: '100%', background: 'none', border: '1px solid #E2E8F0',
            borderRadius: '0.5rem', padding: '0.375rem', cursor: 'pointer',
            fontSize: '0.72rem', color: '#64748B', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
          }}
        >
          {expanded ? '▲ Hide full policy sheet' : `▼ Show all ${Object.keys(l.raw).length} policy columns`}
        </button>

        {expanded && <RawTable raw={l.raw} />}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Lenders() {
  const [data, setData] = useState<LendersResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterProduct, setFilterProduct] = useState('All')
  const [sortBy, setSortBy] = useState<'name' | 'strictness' | 'cibil' | 'vintage'>('name')

  useEffect(() => {
    fetch('/api/lenders')
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail)))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const products = useMemo(() => {
    if (!data) return ['All']
    const set = new Set(data.lenders.map(l => l.product_name ?? '').filter(Boolean))
    return ['All', ...Array.from(set).sort()]
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    let list = data.lenders
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(l =>
        l.lender_name.toLowerCase().includes(q) ||
        (l.product_name ?? '').toLowerCase().includes(q) ||
        (l.entity_types ?? '').toLowerCase().includes(q)
      )
    }
    if (filterProduct !== 'All') {
      list = list.filter(l => l.product_name === filterProduct)
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return a.lender_name.localeCompare(b.lender_name)
      if (sortBy === 'strictness') return strictness(b) - strictness(a)
      if (sortBy === 'cibil') return (b.cibil_min ?? 0) - (a.cibil_min ?? 0)
      if (sortBy === 'vintage') return (b.vintage_min ?? 0) - (a.vintage_min ?? 0)
      return 0
    })
  }, [data, search, filterProduct, sortBy])

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4rem', gap: '1rem' }}>
      <div style={{ width: 44, height: 44, borderRadius: '50%', border: '4px solid #E2E8F0', borderTopColor: '#0D9488', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: '#64748B', fontWeight: 600 }}>Loading lender policies…</p>
    </div>
  )

  if (error) return (
    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.875rem', padding: '1.5rem', textAlign: 'center' }}>
      <p style={{ color: '#DC2626', fontWeight: 700 }}>Failed to load lender policies</p>
      <p style={{ color: '#7F1D1D', fontSize: '0.8rem', marginTop: 4 }}>{error}</p>
    </div>
  )

  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* ── Header strip ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: '1.0625rem', color: '#1B3A6B', margin: 0 }}>
            Lender Policy Catalogue
          </h2>
          <p style={{ color: '#64748B', fontSize: '0.78rem', margin: '2px 0 0' }}>
            {data.total} active lender policies loaded from the Engine 2 policy sheet
          </p>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
          {[
            { color: '#16A34A', label: 'Lenient' },
            { color: '#F59E0B', label: 'Moderate' },
            { color: '#EF4444', label: 'Strict' },
          ].map(({ color, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#64748B', fontWeight: 600 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', background: 'white', borderRadius: '0.875rem', padding: '0.875rem 1.125rem', border: '1px solid #E2E8F0' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.875rem', pointerEvents: 'none' }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search lender name, product…"
            style={{ width: '100%', paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8, border: '1.5px solid #E2E8F0', borderRadius: '0.5rem', fontSize: '0.8rem', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Product filter */}
        <div style={{ flex: '0 0 auto' }}>
          <select
            value={filterProduct}
            onChange={e => setFilterProduct(e.target.value)}
            style={{ padding: '0.5rem 0.75rem', border: '1.5px solid #E2E8F0', borderRadius: '0.5rem', fontSize: '0.8rem', background: 'white', color: '#334155', outline: 'none' }}
          >
            {products.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>

        {/* Sort */}
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600, alignSelf: 'center' }}>Sort:</span>
          {([
            ['name', 'A–Z'],
            ['strictness', 'Strictest first'],
            ['cibil', 'CIBIL min ↓'],
            ['vintage', 'Vintage min ↓'],
          ] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setSortBy(val)}
              style={{
                padding: '0.375rem 0.75rem', borderRadius: 9999, border: 'none', cursor: 'pointer',
                fontSize: '0.72rem', fontWeight: 600,
                background: sortBy === val ? '#1B3A6B' : '#F1F5F9',
                color: sortBy === val ? 'white' : '#475569',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Result count */}
        <span style={{ fontSize: '0.72rem', color: '#94A3B8', marginLeft: 'auto' }}>
          Showing {filtered.length} of {data.total}
        </span>
      </div>

      {/* ── Summary stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        {[
          { label: 'Total Lenders', value: data.total, icon: '🏦', color: '#1B3A6B', bg: '#EFF6FF' },
          { label: 'Avg CIBIL Min', value: Math.round(data.lenders.filter(l => l.cibil_min !== null).reduce((s, l) => s + l.cibil_min!, 0) / Math.max(data.lenders.filter(l => l.cibil_min !== null).length, 1)), icon: '💳', color: '#0D9488', bg: '#F0FDFA' },
          { label: 'Avg Vintage Min', value: `${Math.round(data.lenders.filter(l => l.vintage_min !== null).reduce((s, l) => s + l.vintage_min!, 0) / Math.max(data.lenders.filter(l => l.vintage_min !== null).length, 1))} mo`, icon: '📅', color: '#7C3AED', bg: '#F5F3FF' },
          { label: 'Zero DPD Required', value: `${data.lenders.filter(l => l.dpd90_max === 0).length} lenders`, icon: '⚠️', color: '#DC2626', bg: '#FEF2F2' },
        ].map(({ label, value, icon, color, bg }) => (
          <div key={label} style={{ background: bg, borderRadius: '0.875rem', padding: '0.875rem 1rem', border: `1px solid ${color}22` }}>
            <div style={{ fontSize: '1.25rem', marginBottom: 4 }}>{icon}</div>
            <div style={{ fontSize: '1.375rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: '0.68rem', color: '#64748B', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Policy Table (compact view) ── */}
      <div style={{ background: 'white', borderRadius: '1rem', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#1B3A6B' }}>Policy Comparison Table</span>
          <span style={{ fontSize: '0.68rem', background: '#EFF6FF', color: '#1D4ED8', padding: '1px 8px', borderRadius: 9999, fontWeight: 700 }}>Engine 2 Thresholds</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                {['Lender', 'Product', 'Loan Range', 'CIBIL min', 'Vintage min', 'DPD 90+ max', 'Overdue max', 'Suit max', 'Bounces max', 'Enq 30d max'].map(h => (
                  <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', color: '#475569', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, i) => {
                const strict = strictness(l)
                const rowColor = strict >= 0.7 ? '#FEF2F2' : strict >= 0.4 ? '#FFFBEB' : '#F0FDF4'
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #F8FAFC', background: i % 2 === 0 ? 'white' : '#FAFAFA' }}>
                    <td style={{ padding: '0.5rem 0.75rem', fontWeight: 700, color: '#1B3A6B', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: strict >= 0.7 ? '#EF4444' : strict >= 0.4 ? '#F59E0B' : '#16A34A', flexShrink: 0 }} />
                        {l.lender_name}
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', color: '#64748B', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{l.product_name ?? '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>
                      {l.loan_min !== null || l.loan_max !== null ? (
                        <span style={{ color: '#0F766E', fontWeight: 600 }}>
                          {l.loan_min !== null ? `${(l.loan_min / 100_000).toFixed(0)}L` : '—'} – {l.loan_max !== null ? (l.loan_max >= 10_000_000 ? `${(l.loan_max / 10_000_000).toFixed(0)} Cr` : `${(l.loan_max / 100_000).toFixed(0)}L`) : '—'}
                        </span>
                      ) : <span style={{ color: '#CBD5E1' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700, color: (l.cibil_min ?? 0) >= 750 ? '#DC2626' : (l.cibil_min ?? 0) >= 700 ? '#D97706' : '#16A34A' }}>
                      {l.cibil_min ?? '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748B' }}>{l.vintage_min !== null ? `${l.vintage_min}mo` : '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 600, color: l.dpd90_max === 0 ? '#DC2626' : '#16A34A' }}>{l.dpd90_max ?? '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748B' }}>{l.overdue_max ?? '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 600, color: l.suit_max === 0 ? '#DC2626' : '#16A34A' }}>{l.suit_max ?? '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748B' }}>{l.inward_bounce_max ?? '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#64748B' }}>{l.enq30_max ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Detail Cards ── */}
      <div>
        <h3 style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1B3A6B', margin: '0 0 0.875rem' }}>
          Detailed Policy Cards
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.875rem' }}>
          {filtered.map((l, i) => (
            <LenderCard key={`${l.lender_name}-${i}`} l={l} index={i} />
          ))}
        </div>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#94A3B8', background: 'white', borderRadius: '1rem', border: '1px dashed #E2E8F0' }}>
            No lenders match your search.
          </div>
        )}
      </div>

    </div>
  )
}
