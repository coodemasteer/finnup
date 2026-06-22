'use client'
import { useState, useEffect } from 'react'
import AILoader, { AISpinner } from './AILoader'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'

// ── Types ───────────────────────────────────────────────────────────────────
interface RuleDetail {
  label: string
  passed: boolean
  borrower_value?: number
  lender_min?: number
  lender_max?: number
  headroom: number
  narrative: string
}
interface WeightExplanation {
  w1: number; w2: number; formula: string
  engine1_name: string; engine2_name: string
  how_weights_learned: string; interpretation: string
}
interface LenderResult {
  rank: number
  lender_name: string
  combined_score: number
  p_approved: number
  match_score: number
  engine1_contribution?: number
  engine2_contribution?: number
  engine2_rules?: RuleDetail[]
  match_reasons?: string[]
}
interface ShapRow   { feature: string; importance: number }
interface LimeRow   { condition: string; weight: number }
interface PredictResponse {
  p_approved: number
  primary_model: string
  model_scores: Record<string, number>
  eligible_lenders: number
  total_lenders: number
  avg_match_score: number
  w1: number
  w2: number
  weight_explanation?: WeightExplanation
  top3: LenderResult[]
  all_lenders: { lender_name: string; eligible: boolean; match_score: number; combined_score: number; p_approved?: number; engine1_contribution?: number; engine2_contribution?: number }[]
  shap: ShapRow[] | null
  lime: LimeRow[] | null
  bullets: string[] | null
  floor_p?: number
  score_percentile?: number | null
  credit_tier?: string | null
}

// ── Metric card ─────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, explain, gradient }: {
  label: string; value: string; sub?: string; explain?: string; gradient: string
}) {
  return (
    <div className="metric-card" style={{ background: gradient }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.875rem', fontWeight: 800, lineHeight: 1.1, marginBottom: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', opacity: 0.75 }}>{sub}</div>}
      {explain && <div style={{ fontSize: '0.62rem', opacity: 0.6, marginTop: 4, lineHeight: 1.45 }}>{explain}</div>}
    </div>
  )
}

// ── Default form values ──────────────────────────────────────────────────────
const DEFAULT = {
  company_name: '',
  entity_type: 'Sole Proprietorship',
  product_name: 'Unsecured Business Loan',
  location: 'Mumbai',
  loan_min: 8,
  loan_max: 75,
  tenor_min: 12,
  tenor_max: 36,
  cibil: 720,
  dpd90: 0,
  overdue_count: 0,
  overdue_amount: 0,
  suit_filed: 0,
  vintage: 36,
  age_app: 42,
  net_sales: 7000,
  pat: 210,
  tnw: 500,
  dscr: 1.2,
  current_ratio: 1.3,
  tol_tnw: 1.5,
  inward_bounces: 0,
  outward_bounces: 0,
  enq30: 1,
  ns30: 0,
  gst3: 'All filed',
  gst6: 'All filed',
  owned: 'Owned',
}

const RANK_CONFIG = [
  { label: '🥇 Best Match', gradient: 'linear-gradient(135deg,#16A34A 0%,#15803D 100%)', shadow: '0 8px 24px rgba(22,163,74,0.4)' },
  { label: '🥈 Runner Up',  gradient: 'linear-gradient(135deg,#0D9488 0%,#0f766e 100%)', shadow: '0 8px 24px rgba(13,148,136,0.4)' },
  { label: '🥉 Third',      gradient: 'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)', shadow: '0 8px 24px rgba(245,158,11,0.4)' },
]

// ── Prefill type (matches BatchRow fields) ──────────────────────────────────
interface MatchPrefill {
  company_name?: string; product_name?: string; location?: string; entity_type?: string
  loan_min?: number; loan_max?: number; tenor_min?: number; tenor_max?: number
  cibil_score?: number; dpd90?: number; overdue_accounts?: number; overdue_amount?: number; suit_filed?: number
  vintage?: number; age_app?: number
  net_sales?: number; pat?: number; tnw?: number
  dscr?: number; current_ratio?: number; tol_tnw?: number
  inward_bounces?: number; outward_bounces?: number; enq30?: number; ns30?: number
  gst3?: string; gst6?: string; owned?: string
}

export default function LenderMatching({ prefill }: { prefill?: MatchPrefill | null }) {
  const [form, setForm] = useState(DEFAULT)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PredictResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [xaiTab, setXaiTab] = useState<'shap' | 'lime'>('shap')
  const [showAll, setShowAll] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [championModel, setChampionModel] = useState<string>('XGBoost')

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }))

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadMsg(null); setUploadErr(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/parse-single', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to parse file')
      }
      const data = await res.json()
      setForm(f => ({ ...f, ...data }))
      setUploadMsg(`✅ Form pre-filled from "${file.name}"`)
    } catch (err: unknown) {
      setUploadErr(err instanceof Error ? err.message : String(err))
    }
    // reset input so same file can be re-uploaded
    e.target.value = ''
  }

  // Fetch champion model name on mount
  useEffect(() => {
    fetch('/api/model-status').then(r => r.json()).then(d => {
      if (d.best_model) setChampionModel(d.best_model)
    }).catch(() => {})
  }, [])

  async function runPrediction(f: typeof DEFAULT) {
    setLoading(true); setError(null); setResult(null)
    const body = {
      ...f,
      loan_min:  f.loan_min  * 100_000,
      loan_max:  f.loan_max  * 100_000,
      net_sales: f.net_sales * 100_000,
      pat:       f.pat       * 100_000,
      tnw:       f.tnw       * 100_000,
      company_name: f.company_name || 'DEMO',
    }
    // Attempt up to 2 tries — the first can fail if the server is reloading after a code change
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch('/api/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          if ((res.status === 500 || res.status === 502 || res.status === 503) && attempt < 2) {
            await new Promise(r => setTimeout(r, 3000))
            continue
          }
          let msg = `Server error ${res.status}`
          try { const e = await res.json(); msg = e.detail || msg } catch { /* ignore */ }
          setError(msg); setLoading(false); return
        }
        setResult(await res.json()); setLoading(false); return
      } catch (err: unknown) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 3000)); continue }
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false); return
      }
    }
  }

  // Auto-fill form + run prediction when navigated from Portfolio Screening
  useEffect(() => {
    if (!prefill) return
    const f: typeof DEFAULT = {
      company_name:    prefill.company_name    ?? DEFAULT.company_name,
      entity_type:     prefill.entity_type     ?? DEFAULT.entity_type,
      product_name:    prefill.product_name    ?? DEFAULT.product_name,
      location:        prefill.location        ?? DEFAULT.location,
      loan_min:        prefill.loan_min        ?? DEFAULT.loan_min,
      loan_max:        prefill.loan_max        ?? DEFAULT.loan_max,
      tenor_min:       prefill.tenor_min       ?? DEFAULT.tenor_min,
      tenor_max:       prefill.tenor_max       ?? DEFAULT.tenor_max,
      cibil:           prefill.cibil_score     ?? DEFAULT.cibil,
      dpd90:           prefill.dpd90           ?? DEFAULT.dpd90,
      overdue_count:   prefill.overdue_accounts ?? DEFAULT.overdue_count,
      overdue_amount:  prefill.overdue_amount  ?? DEFAULT.overdue_amount,
      suit_filed:      prefill.suit_filed      ?? DEFAULT.suit_filed,
      vintage:         prefill.vintage         ?? DEFAULT.vintage,
      age_app:         prefill.age_app         ?? DEFAULT.age_app,
      net_sales:       prefill.net_sales       ?? DEFAULT.net_sales,
      pat:             prefill.pat             ?? DEFAULT.pat,
      tnw:             prefill.tnw             ?? DEFAULT.tnw,
      dscr:            prefill.dscr            ?? DEFAULT.dscr,
      current_ratio:   prefill.current_ratio   ?? DEFAULT.current_ratio,
      tol_tnw:         prefill.tol_tnw         ?? DEFAULT.tol_tnw,
      inward_bounces:  prefill.inward_bounces  ?? DEFAULT.inward_bounces,
      outward_bounces: prefill.outward_bounces ?? DEFAULT.outward_bounces,
      enq30:           prefill.enq30           ?? DEFAULT.enq30,
      ns30:            prefill.ns30            ?? DEFAULT.ns30,
      gst3:            prefill.gst3            ?? DEFAULT.gst3,
      gst6:            prefill.gst6            ?? DEFAULT.gst6,
      owned:           prefill.owned           ?? DEFAULT.owned,
    }
    setForm(f)
    runPrediction(f)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await runPrediction(form)
  }

  const pApproved = result?.p_approved ?? 0
  const approvalGradient = pApproved >= 0.3
    ? 'linear-gradient(135deg,#16A34A 0%,#15803D 100%)'
    : pApproved >= 0.2
      ? 'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)'
      : 'linear-gradient(135deg,#EF4444 0%,#DC2626 100%)'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '1.5rem', alignItems: 'start' }}>

      {/* ══════════════ Left: Borrower Form ══════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

        {/* Template / Upload strip */}
        <div style={{
          background: 'white', borderRadius: '0.875rem', padding: '0.875rem 1.25rem',
          border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '0.625rem',
        }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1B3A6B', margin: 0 }}>
            📄 Import from Excel
          </p>
          <p style={{ fontSize: '0.7rem', color: '#64748B', margin: 0 }}>
            Download the template, fill in one borrower's details, then upload to auto-fill the form.
          </p>
          <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
            <a
              href="/api/template/single"
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
              📂 Upload & Fill Form
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleExcelUpload} />
            </label>
          </div>
          {uploadMsg && <p style={{ fontSize: '0.75rem', color: '#16A34A', margin: 0 }}>{uploadMsg}</p>}
          {uploadErr && <p style={{ fontSize: '0.75rem', color: '#EF4444', margin: 0 }}>❌ {uploadErr}</p>}
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Form header */}
        <div style={{
          background: 'linear-gradient(135deg,#1B3A6B 0%,#234785 100%)',
          padding: '1.125rem 1.5rem',
        }}>
          <h2 style={{ color: 'white', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Borrower Profile</h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', margin: '2px 0 0' }}>
            Complete all sections for the best match accuracy
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          <Field label="Company / Entity Name">
            <input className="form-input" placeholder="e.g. Sunshine Exports Pvt Ltd" value={form.company_name} onChange={e => set('company_name', e.target.value)} />
          </Field>

          <Field label="Type of Entity">
            <select className="form-select" value={form.entity_type} onChange={e => set('entity_type', e.target.value)}>
              {['Sole Proprietorship','Private Limited','Partnership','LLP','Public Limited'].map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>

          <Field label="Loan Product">
            <select className="form-select" value={form.product_name} onChange={e => set('product_name', e.target.value)}>
              {['Unsecured Business Loan','Personal Loan','Cash Credit/WCDL','Term Loan',
                'Bill Discounting','Purchase Financing','Loan Against Property','Overdraft Facility','Housing Loan']
                .map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>

          <Field label="Location (City)">
            <input className="form-input" value={form.location} onChange={e => set('location', e.target.value)} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="Loan Min (₹L)">
              <input type="number" className="form-input" value={form.loan_min} min={1} max={500}
                onChange={e => set('loan_min', +e.target.value)} />
            </Field>
            <Field label="Loan Max (₹L)">
              <input type="number" className="form-input" value={form.loan_max} min={10} max={5000}
                onChange={e => set('loan_max', +e.target.value)} />
            </Field>
          </div>
          <p style={{ fontSize: '0.65rem', color: '#94A3B8', margin: '-0.25rem 0 0.25rem', lineHeight: 1.5 }}>
            Borrower’s required loan range. Lenders whose policy max is below your min (or min above your max) are excluded.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="Tenor Min (months)">
              <input type="number" className="form-input" value={form.tenor_min} min={1} max={120}
                onChange={e => set('tenor_min', +e.target.value)} />
            </Field>
            <Field label="Tenor Max (months)">
              <input type="number" className="form-input" value={form.tenor_max} min={1} max={120}
                onChange={e => set('tenor_max', +e.target.value)} />
            </Field>
          </div>
          <p style={{ fontSize: '0.65rem', color: '#94A3B8', margin: '-0.25rem 0 0.25rem', lineHeight: 1.5 }}>
            Preferred repayment period. 12–36 months is standard for MSME working capital. Lenders must offer a tenor that fits within this window.
          </p>

          <SectionHead icon="💳" label="Credit History" />

          <SliderField label="CIBIL Score" value={form.cibil} min={300} max={900}
            onChange={v => set('cibil', v)}
            hint="Hard filter — most lenders require ≥ 650. Scores below 600 disqualify applicants from nearly all lenders." />
          <SliderField label="DPD 90+ (last 12 mo)" value={form.dpd90} min={0} max={10}
            onChange={v => set('dpd90', v)}
            hint="Days Past Due > 90 in the last 12 months. Hard filter — most lenders require 0. Even 1 incident eliminates many lenders." />
          <SliderField label="Overdue Accounts" value={form.overdue_count} min={0} max={10}
            onChange={v => set('overdue_count', v)}
            hint="Number of active accounts with overdue payments. Hard filter — lenders require 0." />
          <Field label="Overdue Amount (₹)" hint="Total outstanding overdue balance. Used alongside overdue count to assess delinquency severity.">
            <input type="number" className="form-input" value={form.overdue_amount}
              onChange={e => set('overdue_amount', +e.target.value)} />
          </Field>
          <SliderField label="Suit Filed Count" value={form.suit_filed} min={0} max={5}
            onChange={v => set('suit_filed', v)}
            hint="Legal suits filed against the borrower or directors. Hard filter — any value > 0 disqualifies most lenders." />

          <SectionHead icon="🏢" label="Business Profile" />

          <SliderField label="Business Vintage (months)" value={form.vintage} min={6} max={120}
            onChange={v => set('vintage', v)}
            hint="How long the business has been operating. 4 lenders accept ≥12 mo · 7 lenders require ≥24 mo · 7 lenders require ≥36 mo (3 yrs). Set to 36+ months to be eligible across all lenders." />
          <SliderField label="Age of Applicant" value={form.age_app} min={21} max={70}
            onChange={v => set('age_app', v)}
            hint="Age of the primary applicant/guarantor. Most lenders require 21–65." />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="Net Sales (₹L)" hint="Annual revenue. Strongest single predictor of ML approval probability.">
              <input type="number" className="form-input" value={form.net_sales}
                onChange={e => set('net_sales', +e.target.value)} />
            </Field>
            <Field label="PAT (₹L)" hint="Profit After Tax — net income after all expenses and taxes. Signals repayment capacity.">
              <input type="number" className="form-input" value={form.pat}
                onChange={e => set('pat', +e.target.value)} />
            </Field>
          </div>
          <Field label="Tangible Networth (₹L)" hint="Total assets minus intangible assets minus total liabilities. Used to compute TOL/TNW ratio.">
            <input type="number" className="form-input" value={form.tnw}
              onChange={e => set('tnw', +e.target.value)} />
          </Field>

          <SectionHead icon="📐" label="Financial Ratios" />

          <SliderField label="DSCR" value={form.dscr} min={0.5} max={3.0} step={0.05}
            onChange={v => set('dscr', v)} decimals={2}
            hint="Debt Service Coverage Ratio = annual net income ÷ annual debt repayments. > 1.25 means the business earns more than enough to service all debt." />
          <SliderField label="Current Ratio" value={form.current_ratio} min={0.5} max={3.0} step={0.05}
            onChange={v => set('current_ratio', v)} decimals={2}
            hint="Current assets ÷ current liabilities. > 1.0 = business can cover short-term obligations. Lenders prefer ≥ 1.2." />
          <SliderField label="TOL / TNW" value={form.tol_tnw} min={0.5} max={5.0} step={0.1}
            onChange={v => set('tol_tnw', v)} decimals={1}
            hint="Total Outstanding Liabilities ÷ Tangible Net Worth. Measures leverage. Lenders typically require < 3.0 — lower is better." />

          <SectionHead icon="🏦" label="Banking & GST" />

          <SliderField label="Inward Bounces" value={form.inward_bounces} min={0} max={10}
            onChange={v => set('inward_bounces', v)}
            hint="Cheque or ECS bounces received into the bank account. Hard filter — most lenders allow a maximum of 2–3." />
          <SliderField label="Outward Bounces" value={form.outward_bounces} min={0} max={10}
            onChange={v => set('outward_bounces', v)}
            hint="Cheques or payments issued that bounced. Signals cash flow stress. Lenders prefer 0." />
          <SliderField label="Enquiries (30d)" value={form.enq30} min={0} max={10}
            onChange={v => set('enq30', v)}
            hint="Credit bureau enquiries in the last 30 days. High count signals the borrower is shopping desperately for credit — red flag for lenders." />
          <SliderField label="New Sanctions (30d)" value={form.ns30} min={0} max={5}
            onChange={v => set('ns30', v)}
            hint="New loan sanctions received in the last 30 days. Indicates recent leverage increase — lenders prefer 0." />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="GST Filing (3 mo)" hint="GST compliance last 3 months.">
              <select className="form-select" value={form.gst3} onChange={e => set('gst3', e.target.value)}>
                {['All filed','Partially filed','Not filed'].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="GST Filing (6 mo)" hint="GST compliance last 6 months. Non-compliance is a red flag — suggests unreported revenue or weak business activity.">
              <select className="form-select" value={form.gst6} onChange={e => set('gst6', e.target.value)}>
                {['All filed','Partially filed','Not filed'].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Property Ownership" hint="Owned property increases lender confidence as it implies available collateral and business stability.">
            <select className="form-select" value={form.owned} onChange={e => set('owned', e.target.value)}>
              {['Owned','Rented'].map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>

          <button type="submit" disabled={loading} className="btn-primary" style={{ marginTop: '0.5rem' }}>
            {loading
              ? <><AISpinner /> Analysing borrower profile…</>
              : <><SearchIcon /> Find Best Lenders</>
            }
          </button>
        </form>
      </div>
      </div>  {/* end left column wrapper */}

      {/* ══════════════ Right: Results ══════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Empty state */}
        {!result && !error && !loading && (
          <div className="card" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '4rem 2rem', textAlign: 'center',
            border: '2px dashed #CBD5E1',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', marginBottom: '1rem',
              background: 'linear-gradient(135deg,#E0F2FE,#F0FDFA)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg style={{ width: 32, height: 32, color: '#0D9488' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 style={{ fontWeight: 700, fontSize: '1rem', color: '#1B3A6B', marginBottom: 8 }}>Ready to Match</h3>
            <p style={{ color: '#64748B', fontSize: '0.875rem', maxWidth: 320 }}>
              Fill in the borrower profile on the left and click <strong>Find Best Lenders</strong> to run both ML + Policy engines.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="card">
            <AILoader title="Running AI Engines…" subtitle={`${championModel} (Champion) · Policy Rules`} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '0.875rem',
            padding: '1rem 1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start'
          }}>
            <span style={{ fontSize: '1.25rem' }}>❌</span>
            <div>
              <p style={{ fontWeight: 700, color: '#DC2626', fontSize: '0.875rem' }}>Prediction failed</p>
              <p style={{ color: '#7F1D1D', fontSize: '0.8rem', marginTop: 2 }}>{error}</p>
            </div>
          </div>
        )}

        {result && (
          <>
            {/* ── Results header ── */}
            {form.company_name && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.75rem 1rem', background: 'linear-gradient(135deg,#F0FDFA,#EFF6FF)', borderRadius: '0.75rem', border: '1px solid #BAE6FD' }}>
                <span style={{ fontSize: '1.25rem' }}>🏢</span>
                <div>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Lender Match Report for</div>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: '#1B3A6B' }}>{form.company_name}</div>
                </div>
              </div>
            )}

            {/* ── Metric cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.875rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <MetricCard
                  label="P(APPROVED) — XGBoost"
                  value={`${(result.p_approved * 100).toFixed(1)}%`}
                  sub={(() => {
                    const approvalRate = (result.floor_p ?? 0.1296) / 1.5
                    const ratio = result.p_approved / approvalRate
                    return `Live XGBoost prediction · ${ratio.toFixed(1)}× avg MSME approval rate`
                  })()}
                  explain={`XGBoost ran predict_proba() on your actual inputs (Net Sales, CIBIL, Vintage, Industry, etc.) and output this probability. It is not a lookup — it is a live inference. The training dataset had an 8.6% approval rate (582/6,735 MSME loans). Must exceed ${((result.floor_p ?? 0.13) * 100).toFixed(0)}% floor. Model accuracy: ROC-AUC 0.773.`}
                  gradient={approvalGradient}
                />
                {/* Credit Tier badge */}
                {result.credit_tier && (
                  <div style={{ background: 'white', border: '1.5px solid #E2E8F0', borderRadius: '0.75rem', padding: '0.625rem 1rem' }}>
                    <div style={{ fontSize: '0.55rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Credit Tier</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 800, color: result.p_approved >= 0.37 ? '#16A34A' : result.p_approved >= 0.182 ? '#0D9488' : result.p_approved >= (result.floor_p ?? 0.13) ? '#F59E0B' : '#EF4444' }}>
                      {result.credit_tier}
                    </div>
                    {result.score_percentile != null && (
                      <div style={{ fontSize: '0.62rem', color: '#94A3B8', marginTop: 2 }}>
                        Top {100 - result.score_percentile}% of all training applicants
                      </div>
                    )}
                    <div style={{ fontSize: '0.6rem', color: '#CBD5E1', marginTop: 3, lineHeight: 1.4 }}>
                      Note: 18% is realistic for a calibrated model on 8.6% approval data. Good borrowers in this dataset typically score 15–35%, not 70–80%.
                    </div>
                  </div>
                )}
              </div>
              <MetricCard
                label="Eligible Lenders — Policy"
                value={`${result.eligible_lenders} / ${result.total_lenders}`}
                sub={`Avg policy compatibility ${result.avg_match_score.toFixed(2)} / 1.0`}
                explain="Lenders whose written credit policies allow this borrower (loan size, CIBIL, vintage, DPD, bounces, enquiries, etc.)"
                gradient="linear-gradient(135deg,#0D9488 0%,#0f766e 100%)"
              />
              <MetricCard
                label="Lender Ranking Formula"
                value={`${result.w1.toFixed(2)}×ML + ${result.w2.toFixed(2)}×Policy`}
                sub={`Combined Score = w₁ × P(approved) + w₂ × Policy MatchScore`}
                explain={`This formula ranks lenders who pass all policy rules. w₁=${result.w1.toFixed(2)} means the ML approval probability drives ${(result.w1*100).toFixed(0)}% of the ranking. w₂=${result.w2.toFixed(2)} means the policy compatibility score contributes the remaining ${(result.w2*100).toFixed(0)}%. Policy rules are a hard gate — lenders who fail any rule are excluded before this formula runs. Among those that pass, ML dominates.`}
                gradient="linear-gradient(135deg,#1B3A6B 0%,#0f2548 100%)"
              />
            </div>  {/* end metric cards grid */}

            {/* ── Model comparison panel ── */}
            {result.model_scores && Object.keys(result.model_scores).length > 1 && (
              <div className="card" style={{ padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1B3A6B' }}>
                    All Models Evaluated — Why {result.primary_model}?
                  </span>
                  <span style={{ fontSize: '0.65rem', background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0', borderRadius: 9999, padding: '2px 8px', fontWeight: 700 }}>★ Primary model selected</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(() => {
                    const MODEL_AUCS: Record<string, { auc: number; note: string }> = {
                      'XGBoost':            { auc: 0.773, note: 'Best — gradient boosting, lowest Brier score (0.074)' },
                      'LightGBM':           { auc: 0.758, note: 'Strong — fast boosting, close 2nd' },
                      'Random Forest':      { auc: 0.709, note: 'Good — tree ensemble, higher Brier score (0.120)' },
                      'Logistic Regression':{ auc: 0.647, note: 'Baseline — linear, misses non-linear patterns' },
                    }
                    const riskBand = (p: number): { label: string; bg: string; color: string } => {
                      if (p >= 0.50) return { label: 'Low Risk',    bg: '#DCFCE7', color: '#16A34A' }
                      if (p >= 0.20) return { label: 'Medium Risk', bg: '#FEF9C3', color: '#A16207' }
                      return               { label: 'High Risk',   bg: '#FEE2E2', color: '#DC2626' }
                    }
                    const sorted = Object.entries(result.model_scores).sort((a, b) => {
                      const a_auc = MODEL_AUCS[a[0]]?.auc ?? 0
                      const b_auc = MODEL_AUCS[b[0]]?.auc ?? 0
                      return b_auc - a_auc
                    })
                    return sorted.map(([name, prob]) => {
                      const info   = MODEL_AUCS[name] ?? { auc: null, note: '' }
                      const isPrimary = name === result.primary_model
                      const band   = riskBand(prob)
                      const barColor = isPrimary ? '#16A34A' : prob >= 0.50 ? '#16A34A' : prob >= 0.20 ? '#F59E0B' : '#EF4444'
                      return (
                        <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: isPrimary ? '0.5rem 0.625rem' : '0.25rem 0', background: isPrimary ? '#F0FDF4' : 'transparent', borderRadius: isPrimary ? '0.5rem' : 0, border: isPrimary ? '1px solid #BBF7D0' : 'none' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: isPrimary ? 700 : 500, color: isPrimary ? '#16A34A' : '#334155', display: 'flex', alignItems: 'center', gap: 4 }}>
                              {isPrimary && <span>★</span>}{name}
                              {info.auc && <span style={{ fontSize: '0.65rem', color: '#64748B', fontWeight: 400 }}>· AUC {info.auc.toFixed(3)}</span>}
                              {isPrimary && <span style={{ fontSize: '0.6rem', background: '#DCFCE7', color: '#16A34A', border: '1px solid #86EFAC', borderRadius: 9999, padding: '0 6px', fontWeight: 700 }}>PRIMARY</span>}
                            </span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: barColor }}>{(prob * 100).toFixed(1)}%</span>
                          </div>
                          <div style={{ height: 5, background: '#F1F5F9', borderRadius: 9999, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${prob * 100}%`, background: barColor, borderRadius: 9999, transition: 'width 0.5s ease' }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            {info.note && <span style={{ fontSize: '0.65rem', color: '#94A3B8' }}>{info.note}</span>}
                            <span style={{ fontSize: '0.65rem', fontWeight: 600, background: band.bg, color: band.color, padding: '1px 7px', borderRadius: 9999, marginLeft: 'auto' }}>{band.label}</span>
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
                <p style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '0.75rem', borderTop: '1px solid #F1F5F9', paddingTop: '0.5rem' }}>
                  <strong>ROC-AUC</strong> measures how often the model correctly ranks an approved borrower above a rejected one (0.5 = coin flip, 1.0 = perfect). At 0.773, {result.primary_model} gets it right 77% of the time.
                  {' '}{result.primary_model} is selected as primary and its probability drives all scoring; other models are shown for transparency.
                </p>
                <p style={{ fontSize: '0.68rem', color: '#475569', marginTop: '0.5rem', background: '#F8FAFC', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', lineHeight: 1.6 }}>
                  <strong>How is {(result.p_approved * 100).toFixed(1)}% computed?</strong>{' '}
                  <strong>{result.primary_model}</strong> ran <code style={{ background: '#E2E8F0', padding: '0 3px', borderRadius: 3 }}>predict_proba()</code> live on your specific inputs (Net Sales, CIBIL, Vintage, Industry, Location, etc.) and returned a raw probability of <strong>{(result.p_approved * 100).toFixed(1)}%</strong>.
                  Each model above sees the same inputs and outputs its own independent approval probability — the spread between them shows model uncertainty.
                  {result.primary_model} is selected as primary (highest ROC-AUC on training data) and its score is what drives all lender rankings.
                  This is not a lookup or average — it is a live inference against patterns learned from 6,735 historical MSME loan decisions.
                  Change any input (e.g., raise Net Sales or CIBIL) and all model scores update instantly.
                </p>
              </div>
            )}

            {/* ── Floor warning ── */}
            {result.p_approved < (result.floor_p ?? 0.20) && (() => {
              const floorP       = result.floor_p ?? 0.13
              const baseRate     = floorP / 1.5
              const isBorderline = result.p_approved >= baseRate
              const gapPp        = ((floorP - result.p_approved) * 100).toFixed(1)
              const bgColor      = isBorderline ? '#FFFBEB' : '#FEF2F2'
              const borderClr    = isBorderline ? '#FDE68A' : '#FECACA'
              const headColor    = isBorderline ? '#92400E' : '#DC2626'
              const bodyColor    = isBorderline ? '#78350F' : '#7F1D1D'
              const tipColor     = isBorderline ? '#B45309' : '#991B1B'
              return (
              <div style={{
                background: bgColor, border: `1px solid ${borderClr}`, borderRadius: '0.875rem',
                padding: '1rem 1.25rem'
              }}>
                <p style={{ fontWeight: 700, color: headColor, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                  {isBorderline ? '⚠️' : '🚫'} ML Score = {(result.p_approved * 100).toFixed(1)}%
                  {isBorderline
                    ? ` — Borderline: ${gapPp}pp below the ${(floorP * 100).toFixed(0)}% recommendation threshold`
                    : ` — Below the ${(floorP * 100).toFixed(0)}% minimum threshold`}
                </p>
                <p style={{ color: bodyColor, fontSize: '0.78rem', marginBottom: result.bullets || result.shap ? '1rem' : 0 }}>
                  {isBorderline
                    ? <>
                        This borrower scores <strong>above the dataset&apos;s {(baseRate * 100).toFixed(1)}% average approval rate</strong> — this is <em>not</em> a high-risk profile.
                        The ML score of {(result.p_approved * 100).toFixed(1)}% is {gapPp}pp short of the {(floorP * 100).toFixed(0)}% recommendation floor.
                        Addressing the borderline factors below could push the score over the threshold.
                      </>
                    : <>
                        No lenders recommended. The ML model assessed this borrower as genuinely high credit risk (below
                        the {(baseRate * 100).toFixed(1)}% dataset average). Floor is set dynamically at{' '}
                        <strong>1.5× the training approval rate</strong> ({(floorP * 100).toFixed(0)}%) — not a fixed threshold.
                      </>}
                </p>

                {/* Layman bullets — pulled from SHAP analysis */}
                {result.bullets && result.bullets.length > 0 && (() => {
                  const redBullets   = result.bullets.filter(b => b.startsWith('🔴'))
                  const amberBullets = result.bullets.filter(b => b.startsWith('🟡'))
                  const greenBullets = result.bullets.filter(b => b.startsWith('🟢'))
                  const riskBullets  = [...redBullets, ...amberBullets]
                  const allGreen     = riskBullets.length === 0
                  const renderBullet = (b: string, i: number) => (
                    <li key={i} style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', gap: '0.5rem', lineHeight: 1.5 }}>
                      <span style={{ flexShrink: 0 }}>→</span>
                      <span dangerouslySetInnerHTML={{ __html: b.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                    </li>
                  )
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '0.75rem' }}>
                      {/* Risk factors block — shown first */}
                      {riskBullets.length > 0 && (() => {
                        const onlyAmber = redBullets.length === 0
                        return (
                        <div style={{
                          background: onlyAmber ? '#FFFBEB' : '#FEF2F2',
                          border: `1px solid ${onlyAmber ? '#FDE68A' : '#FECACA'}`,
                          borderRadius: '0.625rem', padding: '0.875rem 1rem'
                        }}>
                          <p style={{ fontWeight: 700, fontSize: '0.78rem', color: onlyAmber ? '#92400E' : '#991B1B', marginBottom: '0.5rem' }}>
                            {onlyAmber
                              ? `🟡 Borderline factor${riskBullets.length > 1 ? 's' : ''} — small improvements here could push you over the threshold:`
                              : `🚨 Critical risk factor${riskBullets.length > 1 ? 's' : ''} — must be resolved before any lender will consider this application:`}
                          </p>
                          <ul style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem', margin: 0 }}>
                            {riskBullets.map(renderBullet)}
                          </ul>
                        </div>
                        )
                      })()}
                      {/* All-green: show SHAP negatives first, then green bullets */}
                      {allGreen && result.shap && result.shap.length > 0 && (() => {
                        // Filter to meaningful negatives only (>= 0.03) after backend LR-coefficient fix
                        const negShap = [...result.shap]
                          .filter((s: {feature: string; importance: number}) => s.importance < -0.03)
                          .sort((a: {importance: number}, b: {importance: number}) => a.importance - b.importance)
                          .slice(0, 5)
                        if (negShap.length === 0) return null
                        // Context-aware message by feature type
                        const shapMsg = (s: {feature: string; importance: number}): string => {
                          const f = s.feature.toLowerCase()
                          const v = s.importance.toFixed(3)
                          if (f.includes('sole proprietorship') || f.includes('type of entity'))
                            return `Sole Proprietorship has a structurally lower approval rate vs Pvt Ltd / LLP in the training data (SHAP ${v}). Consider restructuring to improve approval odds.`
                          if (f.includes('vintage'))
                            return `Business tenure is below the typical approved-borrower median (SHAP ${v}). Each additional year of operations reduces this gap.`
                          if (f.includes('gst') || f.includes('gstin'))
                            return `GST compliance pattern contributed negatively to this prediction (SHAP ${v}) — likely due to filing recency or frequency relative to approved borrowers.`
                          if (f.includes('loan_to') || f.includes('loan to'))
                            return `Loan-to-revenue ratio is above what approved borrowers typically show (SHAP ${v}). A smaller loan ask or higher revenue would improve this.`
                          return `${s.feature}: the ML assigned a negative contribution of ${v} to this feature in the context of your full profile.`
                        }
                        return (
                          <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '0.625rem', padding: '0.875rem 1rem' }}>
                            <p style={{ fontWeight: 700, fontSize: '0.78rem', color: '#92400E', marginBottom: '0.375rem' }}>
                              🔍 What the ML is weighting against this profile:
                            </p>
                            <ul style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem', margin: '0 0 0.5rem' }}>
                              {negShap.map((s: {feature: string; importance: number}, i: number) => (
                                <li key={i} style={{ fontSize: '0.8rem', color: '#78350F', display: 'flex', gap: '0.5rem', lineHeight: 1.5 }}>
                                  <span style={{ flexShrink: 0, color: '#B45309' }}>▼</span>
                                  <span>{shapMsg(s)}</span>
                                </li>
                              ))}
                            </ul>
                            <p style={{ fontSize: '0.7rem', color: '#92400E', margin: 0, fontStyle: 'italic' }}>
                              SHAP measures each feature’s signed contribution to this prediction relative to the
                              average borrower in training data. Negative = the ML rates this factor below average
                              for your profile. Addressing these is the fastest path to the {(floorP * 100).toFixed(0)}% floor.
                            </p>
                          </div>
                        )
                      })()}
                      {/* Green factors block — shown last */}
                      {greenBullets.length > 0 && (
                        <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: '0.625rem', padding: '0.875rem 1rem' }}>
                          <p style={{ fontWeight: 700, fontSize: '0.78rem', color: '#166534', marginBottom: '0.5rem' }}>
                            {allGreen
                              ? `✅ Your profile strengths (${greenBullets.length} factors) — these are supporting your application:`
                              : `✅ Positives noted (${greenBullets.length}) — these help your case but were not enough to offset the risk factor${riskBullets.length > 1 ? 's' : ''} above:`}
                          </p>
                          <ul style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem', margin: 0 }}>
                            {greenBullets.map(renderBullet)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Top negative SHAP features if no bullets */}
                {!result.bullets && result.shap && result.shap.length > 0 && (
                  <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: '0.625rem', padding: '0.875rem 1rem', marginBottom: '0.75rem' }}>
                    <p style={{ fontWeight: 700, fontSize: '0.78rem', color: '#991B1B', marginBottom: '0.5rem' }}>
                      📋 Top factors dragging the score down:
                    </p>
                    <ul style={{ paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem', margin: 0 }}>
                      {[...result.shap].sort((a, b) => a.importance - b.importance).slice(0, 5).map((s, i) => (
                        <li key={i} style={{ fontSize: '0.8rem', color: '#374151', display: 'flex', gap: '0.5rem' }}>
                          <span style={{ color: '#DC2626', flexShrink: 0 }}>↓</span>
                          <span><strong>{s.feature}</strong> (impact: {s.importance.toFixed(3)})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p style={{ fontSize: '0.72rem', color: tipColor, fontWeight: 600, margin: 0 }}>
                  {isBorderline
                    ? `💡 You need ${gapPp}pp more. ${result.bullets?.some(b => b.startsWith('🟡')) ? 'Improve the borderline factors above and re-score.' : 'Review the SHAP section below to find what to improve.'}`
                    : `💡 ${result.bullets?.some(b => b.startsWith('🔴') || b.startsWith('🟡')) ? 'Address the critical factors above before reapplying.' : 'Review the SHAP & LIME section below for the risk pattern the model found.'}`}
                  {' '}Scroll down to the SHAP &amp; LIME section for a full breakdown.
                </p>
              </div>
              )
            })()}

            {/* ── Top 3 Lenders ── */}
            {result.top3.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* Section header + weight formula */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#1B3A6B', margin: 0 }}>
                    Top {result.top3.length} Recommended Lenders
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <code style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F172A', background: '#F1F5F9', padding: '0.25rem 0.625rem', borderRadius: '0.375rem', whiteSpace: 'nowrap' }}>
                      {result.weight_explanation?.formula ?? `Score = ${(result.w1 * 100).toFixed(0)}%×ML + ${(result.w2 * 100).toFixed(0)}%×Policy`}
                    </code>
                    <span style={{ fontSize: '0.7rem', padding: '0.25rem 0.625rem', borderRadius: 9999, background: '#1B3A6B', color: 'white', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      ML {(result.w1 * 100).toFixed(0)}%
                    </span>
                    <span style={{ fontSize: '0.7rem', padding: '0.25rem 0.625rem', borderRadius: 9999, background: '#0D9488', color: 'white', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      Policy {(result.w2 * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {result.weight_explanation && (
                  <div style={{ background: '#F8FAFC', padding: '0.75rem 0.875rem', borderRadius: '0.5rem', borderLeft: '3px solid #CBD5E1', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <p style={{ fontSize: '0.72rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
                      {result.weight_explanation.how_weights_learned}
                    </p>
                    <p style={{ fontSize: '0.72rem', color: '#374151', margin: 0, lineHeight: 1.6 }}>
                      <strong>Why {(result.w2 * 100).toFixed(0)}% policy?</strong>{' '}
                      {result.w1 > 0.9
                        ? <>
                            Policy rules act as a <strong>hard pass/fail gate</strong> — a lender either allows this borrower or it doesn&apos;t.
                            Among lenders who all pass the screen, their compatibility scores cluster tightly (e.g. 0.62–0.68), giving very little ranking signal.
                            The ML model, trained on 6,735 real loan outcomes, captures approval probability far more precisely.
                            The optimiser found that adding more policy weight <em>reduces</em> ranking accuracy — so it assigned 99% to ML.
                            Policy still matters: it is what determines which {result.eligible_lenders} out of {result.total_lenders} lenders appear at all.
                          </>
                        : <>
                            The optimiser balanced ML approval probability ({(result.w1 * 100).toFixed(0)}%) with lender policy fit ({(result.w2 * 100).toFixed(0)}%) to maximise ranking accuracy on the training data.
                          </>
                      }
                    </p>
                  </div>
                )}

                {/* Lender cards — vertical stack */}
                {result.top3.map((l, i) => {
                  const cfg = RANK_CONFIG[i]!
                  const e1c = l.engine1_contribution ?? result.w1 * l.p_approved
                  const e2c = l.engine2_contribution ?? result.w2 * l.match_score
                  const passCount = l.engine2_rules?.filter(r => r.passed).length ?? 0
                  const totalRules = l.engine2_rules?.length ?? 0
                  return (
                    <div key={l.lender_name} style={{ background: 'white', borderRadius: '1rem', border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>

                      {/* Coloured header band */}
                      <div style={{ background: cfg.gradient, padding: '1rem 1.375rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.8)', marginBottom: 5, textTransform: 'uppercase' }}>
                            {cfg.label}
                          </div>
                          <div style={{ fontSize: '1.125rem', fontWeight: 800, color: 'white', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {l.lender_name}
                          </div>
                          {totalRules > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.7)' }}>{passCount}/{totalRules} policy rules passed</span>
                              <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.25)', borderRadius: 9999, minWidth: 60 }}>
                                <div style={{ width: `${Math.round((passCount / Math.max(totalRules, 1)) * 100)}%`, height: '100%', background: 'rgba(255,255,255,0.85)', borderRadius: 9999 }} />
                              </div>
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Recommendation Score</div>
                          <div style={{ fontSize: '2.25rem', fontWeight: 900, color: 'white', lineHeight: 1 }}>{(l.combined_score * 100).toFixed(1)}%</div>
                          <div style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.55)', marginTop: 3 }}>blended ML + policy score</div>
                        </div>
                      </div>

                      {/* Engine score breakdown */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', borderBottom: totalRules > 0 ? '1px solid #F1F5F9' : 'none' }}>
                        {/* Engine 1 */}
                        <div style={{ padding: '0.875rem 1.375rem', borderRight: '1px solid #F1F5F9' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#1B3A6B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Engine 1 — ML</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1B3A6B', background: '#EFF6FF', padding: '1px 8px', borderRadius: 9999 }}>+{(e1c * 100).toFixed(1)}%</span>
                          </div>
                          <div style={{ height: 6, background: '#EFF6FF', borderRadius: 9999, marginBottom: 5 }}>
                            <div style={{ width: `${Math.min((l.p_approved * 100), 100).toFixed(0)}%`, height: '100%', background: 'linear-gradient(90deg,#1B3A6B,#3B82F6)', borderRadius: 9999 }} />
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748B' }}>Approval probability: <strong style={{ color: '#1B3A6B' }}>{(l.p_approved * 100).toFixed(1)}%</strong></div>
                          <div style={{ fontSize: '0.65rem', color: '#94A3B8', marginTop: 2 }}>{(l.p_approved * 100).toFixed(1)}% × w₁ {result.w1.toFixed(2)} = <strong>+{(e1c * 100).toFixed(1)}%</strong> of score</div>
                        </div>
                        {/* Engine 2 */}
                        <div style={{ padding: '0.875rem 1.375rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#0D9488', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Engine 2 — Policy</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0D9488', background: '#F0FDFA', padding: '1px 8px', borderRadius: 9999 }}>+{(e2c * 100).toFixed(2)}%</span>
                          </div>
                          <div style={{ height: 6, background: '#F0FDFA', borderRadius: 9999, marginBottom: 5 }}>
                            <div style={{ width: `${Math.min((l.match_score * 100), 100).toFixed(0)}%`, height: '100%', background: 'linear-gradient(90deg,#0D9488,#34D399)', borderRadius: 9999 }} />
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748B' }}>Policy compatibility: <strong style={{ color: '#0D9488' }}>{(l.match_score * 100).toFixed(0)}%</strong> / 100%</div>
                          <div style={{ fontSize: '0.65rem', color: '#94A3B8', marginTop: 2 }}>{(l.match_score * 100).toFixed(0)}% × w₂ {result.w2.toFixed(2)} = <strong>+{(e2c * 100).toFixed(2)}%</strong> of score</div>
                        </div>
                      </div>

                      {/* Rule checklist */}
                      {l.engine2_rules && l.engine2_rules.length > 0 && (
                        <div style={{ padding: '0.75rem 1.375rem' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                            <p style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.09em', margin: 0 }}>Policy Checks</p>
                            <span style={{ fontSize: '0.6rem', color: '#CBD5E1' }}>bar = headroom above policy min</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.2rem 1.25rem' }}>
                            {l.engine2_rules.map((r, ri) => (
                              <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', minWidth: 0 }}>
                                <span style={{ fontSize: '0.72rem', flexShrink: 0 }}>{r.passed ? '✅' : '❌'}</span>
                                <span
                                  title={r.narrative || r.label}
                                  style={{ fontSize: '0.7rem', color: r.passed ? '#166534' : '#991B1B', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                >{r.label}</span>
                                <span style={{ fontSize: '0.62rem', color: '#94A3B8', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>{Math.round(r.headroom * 100)}%</span>
                                <div style={{ width: 28, height: 4, background: '#E2E8F0', borderRadius: 9999, flexShrink: 0, overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.round(r.headroom * 100)}%`, height: '100%', background: r.passed ? (r.headroom >= 0.5 ? '#16A34A' : r.headroom >= 0.25 ? '#F59E0B' : '#84CC16') : '#EF4444', borderRadius: 9999 }} />
                                </div>
                              </div>
                            ))}
                          </div>
                          <p style={{ fontSize: '0.6rem', color: '#94A3B8', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
                            ✅ = passes policy rule · Bar shows margin above minimum: 100% = binary rule (ideal value) · 25–50% = near minimum · colour: <span style={{ color: '#16A34A', fontWeight: 600 }}>green</span> ≥ 50% · <span style={{ color: '#F59E0B', fontWeight: 600 }}>amber</span> 25–50% · <span style={{ color: '#84CC16', fontWeight: 600 }}>lime</span> &lt; 25%
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── All Lenders Table ── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button
                onClick={() => setShowAll(v => !v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.875rem 1.25rem', background: 'none', cursor: 'pointer',
                  borderBottom: showAll ? '1px solid #E2E8F0' : 'none'
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#1B3A6B' }}>
                  All Lenders — Eligibility &amp; Scores
                </span>
                <span style={{ color: '#0D9488', fontSize: '0.75rem', fontWeight: 600 }}>
                  {showAll ? '▲ Collapse' : '▼ Expand'}
                </span>
              </button>
              {showAll && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Lender</th>
                        <th style={{ textAlign: 'center' }}>Eligible</th>
                        <th style={{ textAlign: 'right' }}>Match (E2)</th>
                        <th style={{ textAlign: 'right' }} title="Borrower creditworthiness score — same for all lenders, set by the ML model">ML Credit Score (E1) ↓ same</th>
                        <th style={{ textAlign: 'right' }}>E1 contrib</th>
                        <th style={{ textAlign: 'right' }}>E2 contrib</th>
                        <th style={{ textAlign: 'right' }}>Combined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.all_lenders.map((l, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 500 }}>{l.lender_name}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 9999,
                              fontSize: '0.7rem', fontWeight: 700,
                              background: l.eligible ? '#DCFCE7' : '#FEE2E2',
                              color: l.eligible ? '#16A34A' : '#EF4444'
                            }}>
                              {l.eligible ? 'YES' : 'NO'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', color: '#475569' }}>{l.match_score?.toFixed(3)}</td>
                          <td style={{ textAlign: 'right', color: '#94A3B8', fontSize: '0.75rem' }}>
                            {((l.p_approved ?? 0) * 100).toFixed(1)}%
                          </td>
                          <td style={{ textAlign: 'right', color: '#1B3A6B' }}>{(l.engine1_contribution ?? 0).toFixed(4)}</td>
                          <td style={{ textAlign: 'right', color: '#0D9488' }}>{(l.engine2_contribution ?? 0).toFixed(4)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: '#1B3A6B' }}>{l.combined_score?.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
                    <strong style={{ color: '#64748B' }}>ML Credit Score (E1)</strong> is the same for every row — it is a
                    borrower-level signal (how creditworthy is this applicant?), not lender-specific.
                    Lender ranking is driven by the <strong style={{ color: '#0D9488' }}>Match (E2)</strong> column
                    and the final <strong style={{ color: '#1B3A6B' }}>Combined</strong> score.
                  </p>
                </div>
              )}
            </div>

            {/* ── XAI Section ── */}
            {(result.shap || result.lime) && (
              <div className="card">
                <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#1B3A6B', marginBottom: '1rem' }}>
                  Why this score? — SHAP &amp; LIME Explanations
                  <span style={{ display: 'block', fontWeight: 400, fontSize: '0.72rem', color: '#94A3B8', marginTop: 2 }}>
                    SHAP = SHapley Additive exPlanations &nbsp;·&nbsp; LIME = Local Interpretable Model-agnostic Explanations
                  </span>
                </h3>

                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  {(['shap', 'lime'] as const).map(t => (
                    <button key={t} onClick={() => setXaiTab(t)} style={{
                      padding: '0.375rem 1rem', borderRadius: 9999, fontSize: '0.8rem', fontWeight: 600,
                      cursor: 'pointer', transition: 'all 150ms',
                      background: xaiTab === t ? '#1B3A6B' : '#F1F5F9',
                      color: xaiTab === t ? 'white' : '#475569',
                      border: 'none',
                    }}>
                      {t === 'shap' ? '📊 SHAP (SHapley)' : '🧪 LIME (Local)'}
                    </button>
                  ))}
                </div>

                {xaiTab === 'shap' && result.shap && (
                  <>
                    <p style={{ fontSize: '0.78rem', color: '#64748B', marginBottom: '1rem' }}>
                      <strong>SHAP</strong> (SHapley Additive exPlanations) — Mean signed SHAP value across all models.
                      <span style={{ color: '#16A34A', fontWeight: 600 }}> Green = increases P(approved)</span> ·
                      <span style={{ color: '#EF4444', fontWeight: 600 }}> Red = decreases P(approved)</span> · bar length = magnitude.
                      P(approved) = <strong style={{ color: '#0D9488' }}>{(result.p_approved * 100).toFixed(1)}%</strong>
                    </p>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart
                        data={[...result.shap].sort((a, b) => Math.abs(a.importance) - Math.abs(b.importance))}
                        layout="vertical" margin={{ left: 160, right: 16 }}>
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="feature" tick={{ fontSize: 10, fill: '#475569' }} width={155} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                          formatter={(v: number) => [v > 0 ? `+${v.toFixed(4)} (helps approval)` : `${v.toFixed(4)} (hurts approval)`, 'SHAP']}
                        />
                        <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                          {[...result.shap].sort((a, b) => Math.abs(a.importance) - Math.abs(b.importance)).map((entry, i) => (
                            <Cell key={i} fill={entry.importance >= 0 ? '#16A34A' : '#EF4444'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    {result.bullets && (
                      <div style={{ marginTop: '1.25rem', background: '#F8FAFC', borderRadius: '0.75rem', padding: '1rem' }}>
                        <h4 style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#1B3A6B', marginBottom: '0.625rem' }}>
                          📝 What this means for your application
                        </h4>
                        <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingLeft: 0, listStyle: 'none' }}>
                          {result.bullets.map((b, i) => (
                            <li key={i} style={{ fontSize: '0.8375rem', color: '#334155', display: 'flex', gap: '0.5rem' }}>
                              <span style={{ color: '#0D9488', flexShrink: 0 }}>→</span>
                              <span dangerouslySetInnerHTML={{ __html: b.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}

                {xaiTab === 'lime' && result.lime && (
                  <>
                    <p style={{ fontSize: '0.78rem', color: '#64748B', marginBottom: '1rem' }}>
                      <strong>LIME</strong> (Local Interpretable Model-agnostic Explanations) — perturbs the profile locally. Bar direction shows whether a condition
                      <strong> increases (+) or decreases (−)</strong> P(approved) = <strong style={{ color: '#0D9488' }}>{(result.p_approved * 100).toFixed(1)}%</strong>
                    </p>
                    <ResponsiveContainer width="100%" height={340}>
                      <BarChart data={[...result.lime].reverse()} layout="vertical" margin={{ left: 200, right: 16 }}>
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="condition" tick={{ fontSize: 9, fill: '#475569' }} width={195} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                          formatter={(v: number) => [v.toFixed(4), 'Weight']}
                        />
                        <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
                          {[...result.lime].reverse().map((entry, i) => (
                            <Cell key={i} fill={entry.weight > 0 ? '#16A34A' : '#EF4444'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#16A34A' }} />
                        green (+) = boosts approval
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#EF4444' }} />
                        red (−) = hurts approval
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      {children}
      {hint && <p style={{ fontSize: '0.63rem', color: '#94A3B8', margin: '3px 0 0', lineHeight: 1.45 }}>{hint}</p>}
    </div>
  )
}

function SliderField({ label, min, max, value, onChange, step = 1, decimals = 0, hint }: {
  label: string; min: number; max: number; value: number
  onChange: (v: number) => void; step?: number; decimals?: number; hint?: string
}) {
  const display = decimals > 0 ? value.toFixed(decimals) : String(value)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
        <span className="slider-value">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)} style={{ height: '0.375rem' }} />
      {hint && <p style={{ fontSize: '0.63rem', color: '#94A3B8', margin: '3px 0 0', lineHeight: 1.45 }}>{hint}</p>}
    </div>
  )
}

function SectionHead({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="section-title" style={{ marginTop: '0.25rem' }}>
      <span>{icon}</span>
      {label}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}
