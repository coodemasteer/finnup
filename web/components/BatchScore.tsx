'use client'
import { useState } from 'react'
import AILoader, { AISpinner } from './AILoader'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'

interface TopLender { lender_name: string; match_score: number; combined_score: number }
export interface BatchRow {
  index: number
  company_name?: string; product_name?: string; location?: string; entity_type?: string
  loan_min?: number; loan_max?: number; tenor_min?: number; tenor_max?: number
  cibil_score?: number; dpd90?: number; overdue_accounts?: number; overdue_amount?: number; suit_filed?: number
  vintage?: number; age_app?: number
  net_sales?: number; pat?: number; tnw?: number
  dscr?: number; current_ratio?: number; tol_tnw?: number
  inward_bounces?: number; outward_bounces?: number; enq30?: number; ns30?: number
  gst3?: string; gst6?: string; owned?: string
  p_approved_pct: number; label: string; risk_band: string
  top_lenders?: TopLender[]
}
interface BatchResponse {
  total: number; high_prob: number; medium_prob: number; low_prob: number
  confirmed_approved: number; confirmed_rejected: number
  rows: BatchRow[]; histogram: number[]
}

const RISK_COLORS: Record<string, string> = {
  'Prime':    'text-green bg-green/10',
  'Strong':   'text-teal bg-teal/10',
  'Moderate': 'text-amber bg-amber/10',
  'Watch':    'text-red bg-red/10',
}

export default function BatchScore({ onNavigate }: { onNavigate?: (tab: string, row?: BatchRow) => void }) {
  const [data, setData] = useState<BatchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [uploadSource, setUploadSource] = useState<'dataset' | 'upload'>('dataset')
  const PAGE_SIZE = 50

  async function runBatch() {
    setLoading(true); setError(null); setData(null)
    try {
      const res = await fetch('/api/batch-score', { method: 'POST' })
      if (!res.ok) {
        const text = await res.text()
        let detail = 'Batch scoring failed'
        try { detail = JSON.parse(text).detail || detail } catch { detail = text || detail }
        throw new Error(detail)
      }
      const result = await res.json()
      setData(result)
      setUploadSource('dataset')
      setPage(0)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true); setError(null); setData(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/batch-score-upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const text = await res.text()
        let detail = 'Upload scoring failed'
        try { detail = JSON.parse(text).detail || detail } catch { detail = text || detail }
        throw new Error(detail)
      }
      const result = await res.json()
      setData(result)
      setUploadSource('upload')
      setPage(0)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
    e.target.value = ''
  }

  // Build histogram buckets
  const histData = data
    ? Array.from({ length: 20 }, (_, i) => {
        const lo = i * 5, hi = lo + 5
        return {
          bucket: `${lo}–${hi}%`,
          count: data.histogram.filter(p => p * 100 >= lo && p * 100 < hi).length,
        }
      })
    : []

  const filtered = data
    ? data.rows.filter(r =>
        !search || r.company_name?.toLowerCase().includes(search.toLowerCase()) ||
        r.product_name?.toLowerCase().includes(search.toLowerCase()) ||
        r.entity_type?.toLowerCase().includes(search.toLowerCase())
      )
    : []
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  function downloadCSV() {
    if (!data) return
    const header = ['#','Company','Product','CIBIL','Vintage(mo)','Net Sales(₹)','Overdue Accts','Entity','P(Approved)%','Label','Approval Band']
    const rows = data.rows.map(r => [
      r.index, r.company_name ?? '', r.product_name ?? '',
      r.cibil_score ?? '', r.vintage ?? '', r.net_sales ?? '',
      r.overdue_accounts ?? '', r.entity_type ?? '',
      r.p_approved_pct, r.label, r.risk_band
    ])
    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = 'finnup_all_borrowers_scored.csv'; a.click()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Template strip */}
      <div style={{
        background: 'white', borderRadius: '0.875rem', padding: '0.875rem 1.25rem',
        border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem',
      }}>
        <div>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1B3A6B', margin: 0 }}>
            📄 Score your own borrowers
          </p>
          <p style={{ fontSize: '0.7rem', color: '#64748B', margin: '2px 0 0' }}>
            Download the Excel template, fill in your borrowers, then upload to score them instantly.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
          <a
            href="/api/template/batch"
            download
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              background: 'linear-gradient(135deg,#1B3A6B,#234785)',
              color: 'white', fontWeight: 600, fontSize: '0.8rem',
              padding: '0.5rem 1rem', borderRadius: '0.5rem',
              border: 'none', cursor: 'pointer', textDecoration: 'none',
            }}
          >
            ⬇ Download Template
          </a>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
            background: '#F0FDFA', color: '#0D9488', fontWeight: 600, fontSize: '0.8rem',
            padding: '0.5rem 1rem', borderRadius: '0.5rem',
            border: '1.5px solid #0D9488', cursor: 'pointer',
          }}>
            📂 Upload & Score Excel
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />
          </label>
        </div>
      </div>

      {/* Page header */}
      <div className="card" style={{ padding: '1.125rem 1.5rem', background: 'linear-gradient(135deg,#1B3A6B 0%,#234785 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 style={{ color: 'white', fontWeight: 700, fontSize: '1rem', margin: 0 }}>
              {uploadSource === 'upload' ? 'Batch Score — Uploaded Borrowers' : 'Batch Score — All Borrowers'}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', margin: '3px 0 0' }}>
              {uploadSource === 'upload'
                ? `${data?.total ?? 0} uploaded applications scored`
                : '6,735 applications · 582 approved (8.6%) · 19 lender policies'
              }
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {data && (
              <button onClick={downloadCSV} style={{
                background: 'rgba(255,255,255,0.15)', color: 'white', fontWeight: 600,
                fontSize: '0.8rem', padding: '0.5rem 1rem', borderRadius: '0.5rem',
                border: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer'
              }}>
                ⬇ CSV
              </button>
            )}
            <button onClick={runBatch} disabled={loading} className="btn-primary" style={{ width: 'auto', padding: '0.625rem 1.25rem' }}>
              {loading
                ? <><AISpinner /> Scoring…</>
                : '▶ Score All Borrowers'
              }
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.875rem', padding: '1rem 1.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.875rem' }}>
          <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>❌</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 700, color: '#DC2626', fontSize: '0.875rem', marginBottom: 4 }}>Batch scoring failed</p>
            <p style={{ color: '#7F1D1D', fontSize: '0.8rem', marginBottom: 8, lineHeight: 1.5 }}>
              {error.includes('Internal Server') || error.includes('503') || error.includes('502')
                ? 'The prediction server is starting up or was temporarily unavailable. This usually resolves in a few seconds.'
                : error}
            </p>
            <button onClick={() => { setError(null); runBatch() }} style={{
              fontSize: '0.78rem', fontWeight: 700, color: '#DC2626', background: 'white',
              border: '1.5px solid #FECACA', borderRadius: '0.5rem',
              padding: '0.375rem 0.875rem', cursor: 'pointer',
            }}>
              ↻ Retry
            </button>
          </div>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="card" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '3.5rem 2rem', textAlign: 'center', border: '2px dashed #CBD5E1'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.875rem' }}>📊</div>
          <p style={{ fontWeight: 700, color: '#1B3A6B', fontSize: '1rem', marginBottom: 6 }}>Ready to Score</p>
          <p style={{ color: '#64748B', fontSize: '0.8rem', maxWidth: 380 }}>
            Click <strong>Score All Borrowers</strong> to run against the full 6,735-application dataset,
            or <strong>Upload &amp; Score Excel</strong> above to score your own borrowers using the template.
          </p>
        </div>
      )}

      {loading && (
        <div className="card">
          <AILoader title="Scoring applications…" subtitle="Loading data · Engineering features · Running ML model" />
        </div>
      )}

      {data && (
        <>
          {/* Summary metric cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.875rem' }}>
            {[
              { label: 'Total Scored',      value: data.total.toLocaleString(),       gradient: 'linear-gradient(135deg,#1B3A6B,#0f2548)' },
              { label: 'Prime (4× avg rate)', value: data.high_prob.toLocaleString(),    gradient: 'linear-gradient(135deg,#16A34A,#15803D)' },
              { label: 'Strong–Moderate',    value: data.medium_prob.toLocaleString(), gradient: 'linear-gradient(135deg,#F59E0B,#D97706)' },
              { label: 'Watch (<avg rate)',   value: data.low_prob.toLocaleString(),     gradient: 'linear-gradient(135deg,#EF4444,#DC2626)' },
            ].map(c => (
              <div key={c.label} className="metric-card" style={{ background: c.gradient }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85, marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: '1.875rem', fontWeight: 800, lineHeight: 1.1 }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Histogram */}
          <div className="card">
            <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#1B3A6B', marginBottom: '1rem' }}>
              Approval Probability Distribution — {data.total.toLocaleString()} Applications
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={histData} barCategoryGap="5%">
                <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: '#94A3B8' }} interval={1} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                  formatter={(v: number) => [`${v} borrowers`, 'Count']}
                />
                <ReferenceLine x="50–55%" stroke="#1B3A6B" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: '50%', fontSize: 9 }} />
                <Bar dataKey="count" fill="#0D9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1B3A6B', flex: 1, margin: 0 }}>
                All {data.total.toLocaleString()} Applications
              </h3>
              <input
                className="form-input"
                style={{ width: 220, fontSize: '0.8rem' }}
                placeholder="Search company / product…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
              />
            </div>
            <div style={{ padding: '0.5rem 1.25rem', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9', fontSize: '0.7rem', color: '#64748B' }}>
              ✅ Confirmed Approved: {data.confirmed_approved.toLocaleString()} &nbsp;·&nbsp;
              ⬜ Not Approved: {data.confirmed_rejected.toLocaleString()} &nbsp;·&nbsp;
              Approval rate: {(data.confirmed_approved / data.total * 100).toFixed(1)}%
              {search && ` · Filtered: ${filtered.length.toLocaleString()}`}
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 440 }}>
              <table className="data-table">
                <thead style={{ position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ textAlign: 'left' }}>#</th>
                    <th style={{ textAlign: 'left' }}>Company</th>
                    <th style={{ textAlign: 'left' }}>Product</th>
                    <th style={{ textAlign: 'right' }}>CIBIL</th>
                    <th style={{ textAlign: 'right' }}>Vintage</th>
                    <th style={{ textAlign: 'right' }}>P(Approved)</th>
                    <th style={{ textAlign: 'center' }}>Approval Band</th>
                    {uploadSource === 'upload' && <th style={{ textAlign: 'left' }}>Top 3 Lenders</th>}
                  </tr>
                </thead>
                <tbody>
                  {paged.map(r => (
                    <tr
                      key={r.index}
                      onClick={() => onNavigate?.('match', r)}
                      title={onNavigate ? 'Click to open full analysis in Predict & Match' : undefined}
                      style={{ cursor: onNavigate ? 'pointer' : 'default' }}
                    >
                      <td style={{ color: '#94A3B8' }}>{r.index}</td>
                      <td style={{ fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.company_name ?? ''}>
                        {r.company_name ?? '—'}
                      </td>
                      <td style={{ color: '#475569', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.cibil_score ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.vintage ? `${r.vintage}mo` : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#1B3A6B' }}>{r.p_approved_pct}%</td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 9999,
                          fontSize: '0.7rem', fontWeight: 700,
                          ...(r.risk_band === 'Prime'    ? { background: '#DCFCE7', color: '#16A34A' }
                            : r.risk_band === 'Strong'   ? { background: '#CCFBF1', color: '#0D9488' }
                            : r.risk_band === 'Moderate' ? { background: '#FEF3C7', color: '#D97706' }
                            : { background: '#FEE2E2', color: '#EF4444' })
                        }}>
                          {r.risk_band}
                        </span>
                      </td>
                      {uploadSource === 'upload' && (
                        <td>
                          {r.top_lenders && r.top_lenders.length > 0
                            ? <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {r.top_lenders.map((l, i) => (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{
                                      fontSize: '0.65rem', fontWeight: 700, color: 'white',
                                      background: i === 0 ? '#1B3A6B' : i === 1 ? '#0D9488' : '#94A3B8',
                                      borderRadius: '50%', width: 16, height: 16,
                                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                    }}>{i + 1}</span>
                                    <span style={{ fontSize: '0.72rem', color: '#374151', fontWeight: 500 }}>
                                      {l.lender_name}
                                    </span>
                                    <span style={{ fontSize: '0.65rem', color: '#0D9488', marginLeft: 2 }}>
                                      {l.combined_score}%
                                    </span>
                                  </div>
                                ))}
                              </div>
                            : <span style={{ color: '#CBD5E1', fontSize: '0.72rem' }}>No match</span>
                          }
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1.25rem', borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{
                    fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: '0.375rem',
                    border: '1px solid #E2E8F0', background: 'white', cursor: page === 0 ? 'not-allowed' : 'pointer',
                    opacity: page === 0 ? 0.4 : 1
                  }}>← Prev</button>
                  <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{page + 1} / {totalPages}</span>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{
                    fontSize: '0.75rem', padding: '0.25rem 0.75rem', borderRadius: '0.375rem',
                    border: '1px solid #E2E8F0', background: 'white', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
                    opacity: page >= totalPages - 1 ? 0.4 : 1
                  }}>Next →</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
