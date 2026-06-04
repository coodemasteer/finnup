'use client'
import { useEffect, useState } from 'react'
import AILoader from './AILoader'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, PieChart, Pie,
} from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Summary { total: number; approved: number; rejected: number; approval_rate: number }
interface BucketRow { bucket: string; total: number; approved: number; rejected: number; rate: number }
interface EntityRow { entity_type: string; total: number; approved: number; rejected: number; rate: number }
interface ProductRow { product: string; total: number; approved: number; rejected: number; rate: number }
interface DpdRow   { dpd_label: string; total: number; approved: number; rate: number }
interface MetricStat { approved_mean: number; rejected_mean: number; approved_median: number; rejected_median: number }
interface ApprovalSample {
  company_name?: string; product_name?: string; entity_type?: string
  cibil_score?: number; vintage_months?: number; net_sales?: number
  loan_amount_min?: number; status?: string; sanctioned_amount?: number
}
interface AnalysisData {
  summary:           Summary
  by_entity:         EntityRow[]
  by_product:        ProductRow[]
  by_cibil:          BucketRow[]
  by_vintage:        BucketRow[]
  by_amount:         BucketRow[]
  by_dpd:            DpdRow[]
  metric_comparison: Record<string, MetricStat>
  approved_samples:  ApprovalSample[]
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const C_APPROVED  = '#16A34A'
const C_REJECTED  = '#EF4444'
const C_TOTAL     = '#1B3A6B'
const C_RATE      = '#0D9488'
const PIE_COLORS  = ['#16A34A', '#EF4444']

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmtLakh  = (v: number | null | undefined) => {
  if (v == null) return '—'
  const l = v / 100_000
  return l >= 100 ? `₹${(l / 100).toFixed(1)} Cr` : `₹${l.toFixed(1)}L`
}
const fmtNum   = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString()

// ── Sub-components ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'white', borderRadius: '0.875rem', padding: '1.25rem 1.5rem',
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: `4px solid ${color}` }}>
      <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: '1.875rem', fontWeight: 800, color: C_TOTAL, margin: '6px 0 0' }}>{value}</p>
      {sub && <p style={{ fontSize: '0.72rem', color: '#64748B', margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', borderRadius: '1rem', padding: '1.25rem 1.5rem',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', color: C_TOTAL, margin: '0 0 1rem' }}>{title}</h3>
      {children}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.625rem 0.875rem', fontSize: 12 }}>
      <p style={{ fontWeight: 700, color: C_TOTAL, margin: '0 0 4px' }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color, margin: '2px 0' }}>{p.name}: {p.value?.toLocaleString()}</p>
      ))}
    </div>
  )
}

// Tooltip for rate-only charts — shows rate %, total, and approved count
const RateTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as (BucketRow | DpdRow) | undefined
  if (!d) return null
  const total    = 'total'    in d ? d.total    : 0
  const approved = 'approved' in d ? d.approved : 0
  const rate     = 'rate'     in d ? d.rate     : 0
  return (
    <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 8,
      padding: '0.625rem 0.875rem', fontSize: 12 }}>
      <p style={{ fontWeight: 700, color: C_TOTAL, margin: '0 0 6px' }}>{label}</p>
      <p style={{ color: C_RATE,     margin: '2px 0', fontWeight: 700 }}>Approval rate: {rate}%</p>
      <p style={{ color: C_APPROVED, margin: '2px 0' }}>Approved: {approved.toLocaleString()}</p>
      <p style={{ color: '#94A3B8',  margin: '2px 0' }}>Total: {total.toLocaleString()}</p>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function LoanAnalysis() {
  const [data,    setData]    = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [search,  setSearch]  = useState('')
  const [samplePage, setSamplePage] = useState(0)
  const PAGE_SIZE = 10

  useEffect(() => {
    setLoading(true)
    fetch('/api/loan-analysis')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 340 }}>
      <AILoader title="Analysing 6,735 loan records…" subtitle="Reading historical dataset · Computing approval patterns" size="lg" />
    </div>
  )

  if (error || !data) return (
    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '1rem',
      padding: '1.5rem', color: '#991B1B' }}>
      Failed to load analysis: {error ?? 'Unknown error'}
    </div>
  )

  const { summary, by_entity, by_product, by_cibil, by_vintage, by_amount,
          by_dpd, metric_comparison, approved_samples } = data

  // Filtered samples
  const filtered = approved_samples.filter(r =>
    !search || (r.company_name ?? '').toLowerCase().includes(search.toLowerCase())
      || (r.product_name ?? '').toLowerCase().includes(search.toLowerCase())
      || (r.entity_type ?? '').toLowerCase().includes(search.toLowerCase())
  )
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated  = filtered.slice(samplePage * PAGE_SIZE, (samplePage + 1) * PAGE_SIZE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Header ── */}
      <div>
        <h2 style={{ fontWeight: 800, fontSize: '1.25rem', color: C_TOTAL, margin: 0 }}>
          Historical Loan Analysis
        </h2>
        <p style={{ color: '#64748B', fontSize: '0.8rem', marginTop: 4 }}>
          Pattern analysis of <strong>{fmtNum(summary.total)}</strong> MSME loan applications — what parameters drove approvals vs rejections.
          Source: Capstone training dataset.
        </p>
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
        <SummaryCard label="TOTAL APPLICATIONS"  value={fmtNum(summary.total)}    color={C_TOTAL} />
        <SummaryCard label="APPROVED"            value={fmtNum(summary.approved)} color={C_APPROVED}
          sub={`${summary.approval_rate}% of all applications`} />
        <SummaryCard label="REJECTED"            value={fmtNum(summary.rejected)} color={C_REJECTED}
          sub={`${(100 - summary.approval_rate).toFixed(1)}% of all applications`} />
        <SummaryCard label="APPROVAL RATE"       value={`${summary.approval_rate}%`} color={C_RATE}
          sub="Based on real disbursement status" />
      </div>

      {/* ── Row 1: Pie + Entity type ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.25rem' }}>

        {/* Pie chart */}
        <SectionCard title="Overall Split">
          <PieChart width={220} height={200}>
            <Pie data={[{ name: 'Approved', value: summary.approved },
                        { name: 'Rejected',  value: summary.rejected }]}
              cx={108} cy={90} innerRadius={55} outerRadius={88}
              paddingAngle={3} dataKey="value" label={false}>
              {PIE_COLORS.map((c, i) => <Cell key={i} fill={c} />)}
            </Pie>
            <Tooltip formatter={(v: number) => [v.toLocaleString(), '']} />
          </PieChart>
          <div style={{ display: 'flex', gap: '1rem', marginTop: 4 }}>
            {[{ label: 'Approved', color: C_APPROVED, v: summary.approved },
              { label: 'Rejected',  color: C_REJECTED, v: summary.rejected }].map(x => (
              <div key={x.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: x.color, flexShrink: 0 }} />
                <span style={{ color: '#475569' }}>{x.label}: <strong>{x.v.toLocaleString()}</strong></span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Entity type */}
        <SectionCard title="Approval by Business Entity Type">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={by_entity} margin={{ left: -10, right: 8, top: 4, bottom: 4 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="entity_type" tick={{ fontSize: 11, fill: '#475569' }}
                width={130} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="approved" name="Approved" fill={C_APPROVED} radius={[0,3,3,0]} />
              <Bar dataKey="rejected" name="Rejected" fill={C_REJECTED} radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      {/* ── Row 2: CIBIL + Vintage ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <SectionCard title="Approval by CIBIL Score Range">
          <p style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.75rem', marginTop: 0 }}>
            Higher CIBIL scores show significantly better approval rates. Most applications fall in 650–699 but that bucket has the <em>lowest</em> rate — volume ≠ success.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={by_cibil} margin={{ left: -10, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${v}%`} domain={[0, 'dataMax + 5']} />
              <Tooltip content={<RateTooltip />} />
              <Bar dataKey="rate" name="Approval Rate %" fill={C_RATE} radius={[3,3,0,0]}>
                {by_cibil.map((_, i) => <Cell key={i} fill={C_RATE} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Approval by Business Vintage">
          <p style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.75rem', marginTop: 0 }}>
            Approval rate climbs sharply with vintage. Most applications are 1–2 yrs old (large volume, low rate) — but 5+ yr businesses achieve materially higher rates.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={by_vintage} margin={{ left: -10, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${v}%`} domain={[0, 'dataMax + 5']} />
              <Tooltip content={<RateTooltip />} />
              <Bar dataKey="rate" name="Approval Rate %" fill={C_RATE} radius={[3,3,0,0]}>
                {by_vintage.map((_, i) => <Cell key={i} fill={C_RATE} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      {/* ── Row 3: Loan amount + DPD ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
        <SectionCard title="Approval by Requested Loan Size">
          <p style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.75rem', marginTop: 0 }}>
            Smaller loan requests dominate the dataset but have low approval rates. Hover each bar to see actual approval rate vs volume.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={by_amount} margin={{ left: -10, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${v}%`} domain={[0, 'dataMax + 5']} />
              <Tooltip content={<RateTooltip />} />
              <Bar dataKey="rate" name="Approval Rate %" fill={C_RATE} radius={[3,3,0,0]}>
                {by_amount.map((_, i) => <Cell key={i} fill={C_RATE} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Impact of 90+ DPD on Approvals">
          <p style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.75rem', marginTop: 0 }}>
            Even a single 90+ DPD event in the past 12 months drastically reduces approval probability.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={by_dpd} margin={{ left: -10, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="dpd_label" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${v}%`} domain={[0, 'dataMax + 5']} />
              <Tooltip content={<RateTooltip />} />
              <Bar dataKey="rate" name="Approval Rate %" fill={C_RATE} radius={[3,3,0,0]}>
                {by_dpd.map((_, i) => <Cell key={i} fill={C_RATE} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      {/* ── Product approval rates ── */}
      <SectionCard title="Approval Rate by Loan Product">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={by_product} margin={{ left: 0, right: 16, top: 4, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis dataKey="product" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false}
              angle={-25} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="approved" name="Approved" fill={C_APPROVED} radius={[3,3,0,0]} />
            <Bar dataKey="rejected" name="Rejected" fill={C_REJECTED} radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* ── Metric comparison table ── */}
      <SectionCard title="Key Metric Comparison: Approved vs Rejected">
        <p style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '1rem', marginTop: 0 }}>
          Average and median values across all 6,735 applications, split by approval outcome.
          Approved applicants consistently show higher CIBIL scores, longer vintage, and better financials.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                <th style={{ textAlign: 'left', padding: '0.625rem 0.875rem', fontWeight: 700, color: C_TOTAL }}>Metric</th>
                <th style={{ textAlign: 'right', padding: '0.625rem 0.875rem', fontWeight: 700, color: C_APPROVED }}>Approved — Avg</th>
                <th style={{ textAlign: 'right', padding: '0.625rem 0.875rem', fontWeight: 700, color: C_REJECTED }}>Rejected — Avg</th>
                <th style={{ textAlign: 'right', padding: '0.625rem 0.875rem', fontWeight: 700, color: C_APPROVED }}>Approved — Median</th>
                <th style={{ textAlign: 'right', padding: '0.625rem 0.875rem', fontWeight: 700, color: C_REJECTED }}>Rejected — Median</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metric_comparison).map(([metric, stat], i) => {
                const isMoneyMetric = metric.includes('₹')
                const fmt = (v: number) => isMoneyMetric ? fmtLakh(v) : v.toLocaleString(undefined, { maximumFractionDigits: 1 })
                return (
                  <tr key={metric} style={{ background: i % 2 === 0 ? 'white' : '#F8FAFC',
                    borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '0.625rem 0.875rem', fontWeight: 600, color: '#374151' }}>{metric}</td>
                    <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', color: C_APPROVED, fontWeight: 700 }}>
                      {fmt(stat.approved_mean)}
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', color: C_REJECTED }}>
                      {fmt(stat.rejected_mean)}
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', color: C_APPROVED, fontWeight: 700 }}>
                      {fmt(stat.approved_median)}
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', color: C_REJECTED }}>
                      {fmt(stat.rejected_median)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* ── Approved applications sample ── */}
      <SectionCard title={`Approved Applications — Sample (${summary.approved} total approved)`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <input
            type="text" placeholder="Search company, product, entity type…"
            value={search} onChange={e => { setSearch(e.target.value); setSamplePage(0) }}
            style={{ flex: 1, padding: '0.5rem 0.875rem', borderRadius: '0.5rem', border: '1.5px solid #CBD5E1',
              fontSize: '0.8rem', outline: 'none' }}
          />
          {search && (
            <button onClick={() => { setSearch(''); setSamplePage(0) }}
              style={{ padding: '0.4rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #CBD5E1',
                background: 'white', cursor: 'pointer', fontSize: '0.75rem', color: '#475569' }}>
              ✕ Clear
            </button>
          )}
          <span style={{ fontSize: '0.72rem', color: '#94A3B8', whiteSpace: 'nowrap' }}>
            {filtered.length} results
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                {['Company', 'Product', 'Entity Type', 'CIBIL', 'Vintage', 'Net Sales', 'Loan Min', 'Status', 'Sanctioned'].map(h => (
                  <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: h === 'Company' || h === 'Product' || h === 'Entity Type' || h === 'Status' ? 'left' : 'right',
                    fontWeight: 700, color: C_TOTAL, fontSize: '0.75rem' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F1F5F9',
                  background: i % 2 === 0 ? 'white' : '#F8FAFC' }}>
                  <td style={{ padding: '0.5rem 0.75rem', maxWidth: 160, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: '#1B3A6B' }}>
                    {r.company_name ?? '—'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.775rem', color: '#475569' }}>
                    {r.product_name ?? '—'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.775rem', color: '#475569' }}>
                    {r.entity_type ?? '—'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700,
                    color: r.cibil_score != null && r.cibil_score >= 700 ? C_APPROVED : '#F59E0B' }}>
                    {r.cibil_score ?? '—'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                    {r.vintage_months != null ? `${r.vintage_months} mo` : '—'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                    {fmtLakh(r.net_sales ?? null)}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                    {fmtLakh(r.loan_amount_min ?? null)}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600,
                      background: '#DCFCE7', color: '#166534' }}>
                      {r.status ?? 'Approved'}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: C_APPROVED }}>
                    {fmtLakh(r.sanctioned_amount ?? null)}
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#94A3B8' }}>
                  No results found
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
            <button onClick={() => setSamplePage(p => Math.max(0, p - 1))} disabled={samplePage === 0}
              style={{ padding: '0.375rem 0.75rem', borderRadius: '0.5rem',
                border: '1px solid #CBD5E1', background: samplePage === 0 ? '#F8FAFC' : 'white',
                color: samplePage === 0 ? '#CBD5E1' : C_TOTAL, cursor: samplePage === 0 ? 'default' : 'pointer',
                fontWeight: 600, fontSize: '0.78rem' }}>
              ← Prev
            </button>
            <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
              Page {samplePage + 1} of {totalPages}
            </span>
            <button onClick={() => setSamplePage(p => Math.min(totalPages - 1, p + 1))} disabled={samplePage === totalPages - 1}
              style={{ padding: '0.375rem 0.75rem', borderRadius: '0.5rem',
                border: '1px solid #CBD5E1', background: samplePage === totalPages - 1 ? '#F8FAFC' : 'white',
                color: samplePage === totalPages - 1 ? '#CBD5E1' : C_TOTAL,
                cursor: samplePage === totalPages - 1 ? 'default' : 'pointer',
                fontWeight: 600, fontSize: '0.78rem' }}>
              Next →
            </button>
          </div>
        )}
      </SectionCard>

    </div>
  )
}
