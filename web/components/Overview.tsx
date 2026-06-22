'use client'
import React, { useState, useEffect } from 'react'

// ── tiny helpers ──────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.0625rem', fontWeight: 800, color: '#1B3A6B', margin: '0 0 1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #E2E8F0' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Pill({ label, color = '#1B3A6B' }: { label: string; color?: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 9999, background: color, color: 'white', fontSize: '0.7rem', fontWeight: 700 }}>
      {label}
    </span>
  )
}

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(children).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }
  return (
    <div style={{ position: 'relative', marginBottom: '0.875rem' }}>
      <pre style={{
        background: '#0F172A', color: '#E2E8F0', fontSize: '0.75rem',
        padding: '1rem 3rem 1rem 1rem', borderRadius: '0.75rem',
        overflowX: 'auto', fontFamily: 'monospace', lineHeight: 1.7, margin: 0,
      }}>
        {children}
      </pre>
      <button
        onClick={copy}
        style={{
          position: 'absolute', top: 8, right: 10, background: copied ? '#16A34A' : 'rgba(255,255,255,0.12)',
          color: 'white', border: 'none', borderRadius: 6, padding: '3px 8px',
          fontSize: '0.65rem', cursor: 'pointer', fontWeight: 600, transition: 'background 200ms',
        }}
      >
        {copied ? '✓ copied' : 'copy'}
      </button>
    </div>
  )
}

function FieldRow({ field, type, required, unit, description, style }: {
  field: string; type: string; required?: boolean; unit?: string; description: string; style?: React.CSSProperties
}) {
  return (
    <tr style={style}>
      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.78rem', color: '#1B3A6B', whiteSpace: 'nowrap', fontWeight: 600 }}>{field}</td>
      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.72rem', color: '#64748B' }}>{type}</td>
      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.72rem', textAlign: 'center' }}>
        {required ? <span style={{ color: '#EF4444', fontWeight: 700 }}>required</span> : <span style={{ color: '#94A3B8' }}>optional</span>}
      </td>
      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.72rem', color: '#64748B' }}>{unit ?? '—'}</td>
      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', color: '#334155', lineHeight: 1.5 }}>{description}</td>
    </tr>
  )
}

// ── Field reference data ──────────────────────────────────────────────────────
const FIELDS = [
  { field: 'company_name',   type: 'string',  unit: '—',            description: 'Business / entity name. Cosmetic only — used in reports and the result header. Not used in ML scoring.' },
  { field: 'entity_type',    type: 'string',  unit: '—',            description: 'Legal constitution of the business. Affects lender eligibility rules. Values: Sole Proprietorship, Private Limited, Partnership, LLP, Public Limited.' },
  { field: 'product_name',   type: 'string',  unit: '—',            description: 'Loan product being applied for. Maps to lender product filters. E.g. Unsecured Business Loan, Term Loan, Loan Against Property.' },
  { field: 'location',       type: 'string',  unit: '—',            description: 'City of operation. Some lenders restrict geography.' },
  { field: 'loan_min',       type: 'float',   unit: '₹ (raw)',      description: 'Minimum loan amount sought by the borrower in rupees. Must fall within lender\'s sanctioned range for eligibility.' },
  { field: 'loan_max',       type: 'float',   unit: '₹ (raw)',      description: 'Maximum loan amount sought. Used with loan_min to check against lender ticket size limits.' },
  { field: 'cibil',          type: 'integer', unit: '300–900',      description: 'CIBIL credit score. The single strongest predictor. Most lenders require ≥ 700. Score < 650 typically disqualifies all lenders.' },
  { field: 'dpd90',          type: 'integer', unit: 'count',        description: 'Number of DPD 90+ events (payments > 90 days overdue) in the last 12 months. Any value ≥ 1 fails many lender policies.' },
  { field: 'overdue_count',  type: 'integer', unit: 'count',        description: 'Total number of currently overdue loan accounts. A key negative signal in both ML and policy engines.' },
  { field: 'overdue_amount', type: 'float',   unit: '₹',            description: 'Total overdue outstanding amount in rupees. Combines with overdue_count for a severity measure.' },
  { field: 'suit_filed',     type: 'integer', unit: 'count',        description: 'Count of legal suits filed against the borrower. Even 1 disqualifies from most lenders.' },
  { field: 'vintage',        type: 'integer', unit: 'months',       description: 'Months since business incorporation. Proxy for stability. Most lenders require ≥ 24 months; conservative lenders demand ≥ 36.' },
  { field: 'age_app',        type: 'integer', unit: 'years',        description: 'Age of the primary applicant/promoter. Lenders typically require 21–65. Used as a soft filter.' },
  { field: 'net_sales',      type: 'float',   unit: '₹ (raw)',      description: 'Annual net sales / revenue in rupees. Determines repayment capacity alongside PAT and DSCR.' },
  { field: 'pat',            type: 'float',   unit: '₹ (raw)',      description: 'Profit After Tax — annual, in rupees. Negative PAT (loss-making) significantly reduces ML approval probability.' },
  { field: 'tnw',            type: 'float',   unit: '₹ (raw)',      description: 'Tangible Networth — total assets minus intangibles and liabilities, in rupees. Used in TOL/TNW ratio.' },
  { field: 'dscr',           type: 'float',   unit: 'ratio',        description: 'Debt Service Coverage Ratio = Net Cash Accruals ÷ Total Debt Obligations. Threshold varies: conservative lenders want ≥ 1.5, most accept ≥ 1.2.' },
  { field: 'current_ratio',  type: 'float',   unit: 'ratio',        description: 'Current Ratio = Current Assets ÷ Current Liabilities. Liquidity measure. Most lenders require ≥ 1.0; strong borrowers show ≥ 1.3.' },
  { field: 'tol_tnw',        type: 'float',   unit: 'ratio',        description: 'Total Outside Liabilities ÷ Tangible Networth. Leverage measure. Lower is better; most lenders cap at 3.0.' },
  { field: 'inward_bounces', type: 'integer', unit: 'count',        description: 'Total inward cheque bounces in the last 12 months. Signals payment collection issues for the business.' },
  { field: 'outward_bounces',type: 'integer', unit: 'count',        description: 'Outward cheque bounces — the borrower\'s own payment failures. Highly negative; correlates strongly with defaults.' },
  { field: 'enq30',          type: 'integer', unit: 'count',        description: 'Credit bureau enquiries in the last 30 days. Multiple enquiries indicate credit-hungry behaviour; > 3 is a red flag.' },
  { field: 'ns30',           type: 'integer', unit: 'count',        description: 'New loan sanctions in the last 30 days. Sudden new liabilities may impact repayment capacity.' },
  { field: 'gst3',           type: 'string',  unit: '—',            description: 'GST filing compliance in the last 3 months. Values: All filed, Partially filed, Not filed. Non-compliance signals weak financials.' },
  { field: 'gst6',           type: 'string',  unit: '—',            description: 'GST filing compliance in the last 6 months. Same values as gst3. Used with gst3 for trend analysis.' },
  { field: 'owned',          type: 'string',  unit: '—',            description: 'Whether the primary business / residential property is Owned or Rented. Owned significantly improves match probability for secured products.' },
]

// ── Component ─────────────────────────────────────────────────────────────────
type ModelStatus = {
  best_model: string | null
  best_roc_auc: number | null
  w1: number | null
  w2: number | null
  n_rows: number | null
}

export default function Overview() {
  const [apiTab, setApiTab] = useState<'curl' | 'python' | 'js'>('curl')
  const [ms, setMs] = useState<ModelStatus | null>(null)

  const BASE = 'http://localhost:8080'

  useEffect(() => {
    fetch(`${BASE}/api/model-status`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.model_exists && setMs({
        best_model:   d.best_model  ?? null,
        best_roc_auc: d.best_roc_auc ?? null,
        w1: d.w1 ?? null,
        w2: d.w2 ?? null,
        n_rows: d.last_run?.n_rows ?? null,
      }))
      .catch(() => {})
  }, [])

  const CURL_SINGLE = `curl -X POST "${BASE}/api/match" \\
  -H "Content-Type: application/json" \\
  -d '{
    "company_name": "Sunshine Exports Pvt Ltd",
    "entity_type": "Private Limited",
    "cibil": 720,
    "vintage": 36,
    "loan_min": 2000000,
    "loan_max": 10000000,
    "dscr": 1.3,
    "dpd90": 0,
    "suit_filed": 0
  }'`

  const CURL_MINIMAL = `# All fields have defaults — an empty body is valid
curl -X POST "${BASE}/api/match" \\
  -H "Content-Type: application/json" \\
  -d '{}'`

  const CURL_BATCH = `# Score a file of borrowers — upload an Excel or CSV
curl -X POST "${BASE}/api/batch-score-upload" \\
  -F "file=@/path/to/borrowers.xlsx"

# Score all rows in the training dataset (no file needed)
curl "${BASE}/api/batch-score"`

  const PYTHON_CODE = `import requests

BASE = "${BASE}"

# ── Single borrower ───────────────────────────────────────────────
payload = {
    "company_name": "Sunshine Exports Pvt Ltd",
    "entity_type": "Private Limited",
    "cibil": 720,
    "vintage": 36,
    "loan_min": 2_000_000,
    "loan_max": 10_000_000,
    "dscr": 1.3,
    "dpd90": 0,
    "suit_filed": 0,
    # All other fields take their defaults automatically
}

resp = requests.post(f"{BASE}/api/match", json=payload)
data = resp.json()

print(f"P(approved): {data['p_approved']*100:.1f}%")
print(f"Eligible lenders: {data['eligible_lenders']}/{data['total_lenders']}")
print()
for lender in data["top3"]:
    print(f"#{lender['rank']} {lender['lender_name']}")
    print(f"   Combined score : {lender['combined_score']:.3f}")
    print(f"   ML  (Engine 1) : P={lender['p_approved']*100:.1f}%  contrib={lender['engine1_contribution']:.3f}")
    print(f"   Policy (Eng 2) : match={lender['match_score']:.3f}  contrib={lender['engine2_contribution']:.3f}")
    if lender.get("engine2_rules"):
        for r in lender["engine2_rules"]:
            status = "✅" if r["passed"] else "❌"
            print(f"      {status} {r['label']}  (headroom={r['headroom']:.2f})")

# ── Batch — upload a file ─────────────────────────────────────────
with open("borrowers.xlsx", "rb") as f:
    resp = requests.post(
        f"{BASE}/api/batch-score-upload",
        files={"file": ("borrowers.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
for row in resp.json().get("rows", []):
    print(row.get("company_name"), "→", row.get("top_lender"), f"P={row.get('p_approved', 0)*100:.1f}%")`

  const JS_CODE = `const BASE = '${BASE}';

// ── Single borrower ─────────────────────────────────────────────
async function matchLender(borrower = {}) {
  const res = await fetch(\`\${BASE}/api/match\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(borrower),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const result = await matchLender({
  company_name: 'Sunshine Exports Pvt Ltd',
  entity_type: 'Private Limited',
  cibil: 720,
  vintage: 36,
  loan_min: 2_000_000,
  loan_max: 10_000_000,
  dscr: 1.3,
  dpd90: 0,
});

console.log('P(approved):', (result.p_approved * 100).toFixed(1) + '%');
console.log('Top lender :', result.top3[0]?.lender_name);
console.log('Weight formula:', result.weight_explanation?.formula);

// ── Batch — upload a file ────────────────────────────────────────
async function batchScore(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(\`\${BASE}/api/batch-score-upload\`, {
    method: 'POST', body: form,
  });
  return res.json();
}`

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '2rem', alignItems: 'start' }}>

      {/* ── Sticky sidebar nav ── */}
      <nav style={{ position: 'sticky', top: '1rem' }}>
        <div style={{ background: 'white', borderRadius: '0.875rem', border: '1px solid #E2E8F0', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          {[
            ['#team',         '👥 Team'],
            ['#architecture', '🏗 Architecture'],
            ['#single',       '👤 Single Borrower'],
            ['#batch',        '📋 Batch Scoring'],
            ['#train',        '🧠 Train Model'],
            ['#feedback',     '🔄 Feedback Loop'],
            ['#api',          '🔌 API Integration'],
            ['#fields',       '📖 Field Reference'],
          ].map(([href, label]) => (
            <a key={href} href={href} style={{ display: 'block', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.8rem', fontWeight: 500, color: '#475569', textDecoration: 'none', transition: 'background 120ms' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F1F5F9')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {label}
            </a>
          ))}
        </div>
        <div style={{ background: '#F0FDFA', border: '1px solid #99F6E4', borderRadius: '0.875rem', padding: '0.875rem', marginTop: '1rem', fontSize: '0.72rem', color: '#0F766E', lineHeight: 1.6 }}>
          <strong>Docs:</strong><br />
          <a href="http://localhost:8080/docs" target="_blank" rel="noreferrer" style={{ color: '#0D9488' }}>
            Swagger UI →
          </a><br />
          <a href="http://localhost:8080/redoc" target="_blank" rel="noreferrer" style={{ color: '#0D9488' }}>
            ReDoc →
          </a>
        </div>
      </nav>

      {/* ── Main content ── */}
      <div>

        {/* ── Team ── */}
        {(() => {
          const TEAM = [
            { name: 'Anil',    focus: 'Feature engineering, API development, code review' },
            { name: 'Asha',    focus: 'EDA review, feature validation, UAT testing' },
            { name: 'Arvind',  focus: 'Lender policy review, integration support, final report' },
            { name: 'Bhupesh', focus: 'Data augmentation, lender policy confirmation, API testing' },
            { name: 'Deepak',  focus: 'Label creation, feature selection, FinnUp integration lead' },
            { name: 'Ganesh',  focus: 'Data lead, model training, project coordination' },
            { name: 'Gopal',   focus: 'Model training, Stage 2 lender ranking, results review' },
            { name: 'Hareram', focus: 'Bank data / AA consent, API development, infrastructure' },
            { name: 'Pranali', focus: 'Feature engineering lead, imputation pipeline, peer review' },
            { name: 'Rahul',   focus: 'Model training lead, XGBoost + SHAP, model card author' },
            { name: 'Samik',   focus: 'Stage 2 ranking, end-to-end testing, presentation prep' },
            { name: 'Savitha', focus: 'Data validation, model card review, final report' },
            { name: 'Sonam',   focus: 'Label creation, feature engineering, FinnUp integration support' },
          ]
          const COLORS = [
            '#1B3A6B','#0D9488','#7C3AED','#B45309','#0369A1',
            '#065F46','#9D174D','#1D4ED8','#6D28D9','#047857',
            '#92400E','#1E40AF','#5B21B6',
          ]
          return (
            <section style={{ marginBottom: '2rem' }}>
              <div style={{ background: 'linear-gradient(135deg,#1B3A6B 0%,#0D9488 100%)', borderRadius: '1.25rem', padding: '1.75rem 2rem', marginBottom: '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1.25rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>👥</span>
                  <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 800, color: 'white', letterSpacing: '-0.01em' }}>
                    Team — FinnUp MSME Credit Intelligence
                  </h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: '0.75rem' }}>
                  {TEAM.map((m, i) => (
                    <div key={m.name} style={{
                      background: 'rgba(255,255,255,0.10)',
                      border: '1px solid rgba(255,255,255,0.18)',
                      borderRadius: '0.875rem',
                      padding: '0.875rem 1rem',
                      backdropFilter: 'blur(8px)',
                      display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                    }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                        background: COLORS[i % COLORS.length],
                        border: '2px solid rgba(255,255,255,0.35)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.875rem', fontWeight: 800, color: 'white', letterSpacing: '-0.02em',
                      }}>
                        {m.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'white', marginBottom: '0.2rem' }}>{m.name}</div>
                        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.72)', lineHeight: 1.45 }}>{m.focus}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )
        })()}

        {/* ── Architecture ── */}
        <Section title="🏗 Architecture — How the System Works">
          <div id="architecture" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div style={{ background: 'linear-gradient(135deg,#EFF6FF,#E0F2FE)', border: '1px solid #BAE6FD', borderRadius: '1rem', padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Pill label="Engine 1" color="#1B3A6B" />
                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1B3A6B' }}>ML Ensemble</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.6, margin: 0 }}>
                Four models trained on{' '}
                <strong>{ms?.n_rows?.toLocaleString() ?? '6,735'}</strong> historical MSME loan outcomes —{' '}
                <strong>Logistic Regression</strong>, <strong>Random Forest</strong>,{' '}
                <strong>XGBoost</strong>, and <strong>LightGBM</strong>. Each independently
                outputs a probability of approval. After each training run the model with the
                highest ROC-AUC is promoted as primary —{' '}
                currently <strong>{ms?.best_model ?? '…'}</strong>{' '}
                {ms?.best_roc_auc != null && <>(<strong>ROC-AUC {ms.best_roc_auc.toFixed(3)}</strong>)</>}.
                Its score becomes <code>P(approved)</code>. Other models are shown for transparency.
                A Stacking ensemble (LR trained on all 4 model outputs) is also built — if it
                beats the weighted ensemble on ROC-AUC, its probability becomes the input to the
                w₁/w₂ optimiser, giving the strongest possible signal for blending Engine 1 and
                Engine 2.
              </p>
              <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                {['Logistic Regression', 'Random Forest', 'XGBoost', 'LightGBM'].map(m => {
                  const isWinner = ms?.best_model === m
                  return (
                    <span key={m} style={{
                      fontSize: '0.65rem',
                      background: isWinner ? '#1D4ED8' : '#DBEAFE',
                      color: isWinner ? 'white' : '#1D4ED8',
                      padding: '2px 8px', borderRadius: 9999, fontWeight: 600,
                    }}>{m}{isWinner ? ' ★' : ''}</span>
                  )
                })}
              </div>
            </div>
            <div style={{ background: 'linear-gradient(135deg,#F0FDFA,#ECFDF5)', border: '1px solid #99F6E4', borderRadius: '1rem', padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Pill label="Engine 2" color="#0D9488" />
                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0D9488' }}>Policy Rules</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.6, margin: 0 }}>
                Each lender's credit policy (loaded from the <em>Lender policy</em> sheet) defines
                hard minimum / maximum thresholds for CIBIL, vintage, loan amount, DSCR, DPD,
                overdue accounts, etc. The borrower is checked against every rule and a
                <strong> MatchScore</strong> (0–1) is computed as the fraction of rules passed,
                weighted by headroom.
              </p>
              <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                {['CIBIL threshold', 'Vintage check', 'Loan range', 'DSCR floor', 'DPD 90+', 'Overdue', 'Suit filed', 'Bounce count', 'Enquiries'].map(r => (
                  <span key={r} style={{ fontSize: '0.65rem', background: '#CCFBF1', color: '#0F766E', padding: '2px 8px', borderRadius: 9999, fontWeight: 600 }}>{r}</span>
                ))}
              </div>
            </div>
            <div style={{ background: 'linear-gradient(135deg,#FFF7ED,#FFEDD5)', border: '1px solid #FED7AA', borderRadius: '1rem', padding: '1.25rem', gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Pill label="Continuous Learning" color="#F59E0B" />
                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#92400E' }}>Feedback Loop</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.6, margin: 0 }}>
                After lenders disburse or reject loans, <strong>upload the actual outcomes</strong> (Excel/CSV with a{' '}
                <code>loan_approved</code> column) via the <em>Train Model → Outcome Feedback</em> panel.
                On the next training run, enable <strong>"Include accumulated outcome feedback"</strong> to retrain on
                base data + real decisions — the model accuracy improves over time as real-world signal accumulates.
              </p>
            </div>
          </div>

          {/* Score formula box */}
          <div style={{ background: '#0F172A', borderRadius: '1rem', padding: '1.25rem 1.5rem', marginBottom: '1rem' }}>
            <p style={{ color: '#94A3B8', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.5rem' }}>Combined Score Formula</p>
            <code style={{ color: '#5EEAD4', fontSize: '1.0625rem', fontWeight: 800, fontFamily: 'monospace' }}>
              Combined = w₁ × P(approved) + w₂ × MatchScore
            </code>
            <p style={{ color: '#94A3B8', fontSize: '0.75rem', margin: '0.625rem 0 0', lineHeight: 1.6 }}>
              <strong style={{ color: '#E2E8F0' }}>w₁</strong> and <strong style={{ color: '#E2E8F0' }}>w₂</strong> are
              determined automatically each training run using two methods — a{' '}
              <strong style={{ color: '#5EEAD4' }}>scipy continuous optimiser</strong> (exact w1 that maximises
              ROC-AUC) and a <strong style={{ color: '#5EEAD4' }}>Logistic Regression meta-learner</strong> trained on
              [P(approved), MatchScore] → actual outcomes. The strategy with higher ROC-AUC wins.
              Until the first training run, the system defaults to 0.60 / 0.40.{' '}
              {ms?.w1 != null
                ? <>After training on <strong style={{ color: '#E2E8F0' }}>{ms.n_rows?.toLocaleString() ?? '…'}</strong> samples,
                  the optimiser found{' '}
                  <strong style={{ color: '#5EEAD4' }}>w₁ = {ms.w1.toFixed(2)} / w₂ = {ms.w2?.toFixed(2)}</strong>{' '}
                  — policy rules act as a hard pass/fail gate; among lenders that pass, ML dominates the ranking.
                  These values update automatically on every retrain.
                </>
                : <span style={{ color: '#64748B' }}>Run /api/train to compute optimised weights.</span>
              }
            </p>
          </div>

          {/* Flow diagram */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '1rem', padding: '1.25rem' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.875rem' }}>Data Flow</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
              {[
                { label: 'Borrower Profile', color: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
                null,
                { label: 'Feature Engineering', color: '#F5F3FF', text: '#6D28D9', border: '#DDD6FE' },
                null,
                { label: 'Engine 1 (ML)', color: '#DBEAFE', text: '#1B3A6B', border: '#93C5FD' },
                null,
                { label: 'Engine 2 (Policy)', color: '#CCFBF1', text: '#0F766E', border: '#99F6E4' },
                null,
                { label: 'Weight Blending', color: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
                null,
                { label: 'Credit Tier', color: '#F3E8FF', text: '#7C3AED', border: '#DDD6FE' },
                null,
                { label: 'Top 3 Lenders', color: '#DCFCE7', text: '#166534', border: '#86EFAC' },
                null,
                { label: '🔄 Real Outcomes → Retrain', color: '#FFF7ED', text: '#C2410C', border: '#FED7AA' },
              ].map((item, i) =>
                item === null
                  ? <span key={i} style={{ color: '#CBD5E1', fontSize: '1.25rem' }}>→</span>
                  : (
                    <div key={i} style={{ background: item.color, border: `1px solid ${item.border}`, borderRadius: '0.5rem', padding: '0.375rem 0.75rem', color: item.text, fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                      {item.label}
                    </div>
                  )
              )}
            </div>
          </div>
        </Section>

        {/* ── Single Borrower ── */}
        <Section title="👤 Using the App — Single Borrower">
          <div id="single" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              { step: '1', title: 'Open the Lender Matching tab', body: 'Click the "Lender Matching" tab in the navigation bar. All fields pre-fill with sample values so you can run a test immediately.' },
              { step: '2', title: 'Enter the borrower profile', body: 'Fill in the company name, entity type, loan product, and all financial fields. Use the Excel upload shortcut to import a pre-filled template instead of manually entering data.' },
              { step: '3', title: 'Click "Find Best Lenders"', body: 'Both engines run simultaneously. Engine 1 runs the ML ensemble; Engine 2 evaluates every lender\'s policy rules. Typically completes in < 1 second.' },
              { step: '4', title: 'Read the results', body: 'The result panel shows: (a) P(approved) with Credit Tier badge (e.g. “Strong — top 25%” + percentile rank among 6,735 training applicants), (b) eligible lender count, (c) Top 3 lender cards with full Engine 1 + Engine 2 breakdown, per-rule headroom bars with colour coding, and the blended weight formula.' },
              { step: '5', title: 'Understand the justification', body: 'Scroll to “What this means for your application” for plain-English bullets on every field you entered (CIBIL, DSCR, DPD, PAT, Vintage, etc.). The SHAP chart shows 24 key features — top drivers + all user inputs — with green bars helping approval and red bars hurting it. The “All Models” panel compares XGBoost, LightGBM, Random Forest, and Logistic Regression scores side by side.' },
            ].map(({ step, title, body }) => (
              <div key={step} style={{ display: 'flex', gap: '1rem', background: 'white', border: '1px solid #E2E8F0', borderRadius: '0.875rem', padding: '1rem' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#1B3A6B,#234785)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.875rem', flexShrink: 0 }}>{step}</div>
                <div>
                  <p style={{ fontWeight: 700, color: '#1B3A6B', fontSize: '0.875rem', margin: '0 0 4px' }}>{title}</p>
                  <p style={{ color: '#475569', fontSize: '0.8rem', lineHeight: 1.6, margin: 0 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Batch Scoring ── */}
        <Section title="📋 Batch Scoring — Multiple Borrowers">
          <div id="batch" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              { step: '1', title: 'Download the Batch Template', body: 'In the "Batch Score" tab, click "Download Batch Template". This gives you a pre-formatted Excel file with all 26 borrower fields as column headers, plus a description row and two sample rows.' },
              { step: '2', title: 'Fill in your borrower rows', body: 'Add one borrower per row. Delete the description row (row 2) before uploading, or keep it — the parser auto-detects and skips it. Loan amounts should be in ₹ Lakhs (e.g. 20 = ₹20L); conversion to raw rupees is done automatically.' },
              { step: '3', title: 'Upload and score', body: 'Upload your completed Excel or CSV file. Each row is scored by XGBoost and assigned an Approval Band (Prime ≥ 4× avg · Strong ≥ 2× avg · Moderate ≥ avg rate · Watch < avg rate). Bands are calibrated to the dataset\u2019s 8.6% base approval rate, not arbitrary fixed thresholds.' },
              { step: '4', title: 'Export results', body: 'Download the scored results as a CSV for further analysis or reporting.' },
            ].map(({ step, title, body }) => (
              <div key={step} style={{ display: 'flex', gap: '1rem', background: 'white', border: '1px solid #E2E8F0', borderRadius: '0.875rem', padding: '1rem' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#0D9488,#0f766e)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.875rem', flexShrink: 0 }}>{step}</div>
                <div>
                  <p style={{ fontWeight: 700, color: '#0D9488', fontSize: '0.875rem', margin: '0 0 4px' }}>{title}</p>
                  <p style={{ color: '#475569', fontSize: '0.8rem', lineHeight: 1.6, margin: 0 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Train Model ── */}
        <Section title="🧠 Using the App — Train Model">
          <div id="train" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              { step: '1', title: 'Upload training data (optional)', body: 'In the "Train Model" tab, you can upload a custom Excel/CSV file with your own loan application data. The file must include the same columns as the default dataset. If you skip this, training uses the pre-loaded dataset.' },
              { step: '2', title: 'Configure training options', body: 'Choose which models to include (LR, RF, XGBoost, LightGBM), set the test split size, and decide whether to include accumulated outcome feedback from the feedback loop. Advanced options let you tune class weights and regularisation.' },
              { step: '3', title: 'Click "Train Models"', body: 'Training streams live logs to the UI via SSE (Server-Sent Events). Watch each model train in real time. A progress bar tracks the run. Typically completes in 20–60 seconds depending on dataset size.' },
              { step: '4', title: 'Review results', body: 'The Active Model card shows the winning model (highest ROC-AUC), its metrics, and a plain-English explanation of why it outperformed the others. Expand the metrics table to compare all models side by side.' },
            ].map(({ step, title, body }) => (
              <div key={step} style={{ display: 'flex', gap: '1rem', background: 'white', border: '1px solid #E2E8F0', borderRadius: '0.875rem', padding: '1rem' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#7C3AED,#6D28D9)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.875rem', flexShrink: 0 }}>{step}</div>
                <div>
                  <p style={{ fontWeight: 700, color: '#6D28D9', fontSize: '0.875rem', margin: '0 0 4px' }}>{title}</p>
                  <p style={{ color: '#475569', fontSize: '0.8rem', lineHeight: 1.6, margin: 0 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Feedback Loop ── */}
        <Section title="🔄 Continuous Learning — Feedback Loop">
          <div id="feedback" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '0.875rem', padding: '1rem 1.25rem' }}>
              <p style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1B3A6B', margin: '0 0 0.5rem' }}>Why it matters</p>
              <p style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.6, margin: 0 }}>
                The ML model is trained on synthetic labels initially. As your team processes real applications and lenders make decisions, those <strong>actual outcomes</strong> are far more valuable training data. The feedback loop lets you capture that signal and continuously improve accuracy.
              </p>
            </div>
            {[
              { step: '1', title: 'Download the outcome template', body: 'Click "Download Template" in the Train Model → Outcome Feedback panel. The template has columns for the borrower identifier and loan_approved (1 = approved, 0 = rejected).' },
              { step: '2', title: 'Fill in real decisions', body: 'After lenders disburse or reject loans (typically 2–8 weeks after application), record the actual outcome against each application reference. One row per loan decision.' },
              { step: '3', title: 'Upload outcomes', body: 'Use the "Upload Outcomes" button in the Outcome Feedback panel. Uploads are accumulated — you can upload multiple batches over time. The panel shows a running tally of approved vs rejected outcomes.' },
              { step: '4', title: 'Retrain with feedback', body: 'On the next training run, tick "Include accumulated outcome feedback". The model retrains on base data plus all uploaded real outcomes. Accuracy typically improves as the feedback set grows beyond ~200 rows.' },
            ].map(({ step, title, body }) => (
              <div key={step} style={{ display: 'flex', gap: '1rem', background: 'white', border: '1px solid #E2E8F0', borderRadius: '0.875rem', padding: '1rem' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#F59E0B,#D97706)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.875rem', flexShrink: 0 }}>{step}</div>
                <div>
                  <p style={{ fontWeight: 700, color: '#B45309', fontSize: '0.875rem', margin: '0 0 4px' }}>{title}</p>
                  <p style={{ color: '#475569', fontSize: '0.8rem', lineHeight: 1.6, margin: 0 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── API Integration ── */}
        <Section title="🔌 API Integration Guide">
          <div id="api">
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '0.875rem', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Base URL</p>
              <code style={{ fontSize: '0.9rem', color: '#0D9488', fontFamily: 'monospace', fontWeight: 700 }}>http://localhost:8080</code>
              <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '0.375rem 0 0' }}>
                Interactive docs at{' '}
                <a href="http://localhost:8080/docs" target="_blank" rel="noreferrer" style={{ color: '#0D9488' }}>localhost:8080/docs</a>
                {' '}(Swagger UI) and{' '}
                <a href="http://localhost:8080/redoc" target="_blank" rel="noreferrer" style={{ color: '#0D9488' }}>localhost:8080/redoc</a>
              </p>
            </div>

            {/* Endpoint reference */}
            <div style={{ marginBottom: '1.25rem', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#1B3A6B' }}>
                    {['Method', 'Path', 'Purpose', 'Body / Params'].map(h => (
                      <th key={h} style={{ padding: '0.625rem 0.875rem', color: 'white', fontWeight: 700, textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['POST', '/api/match',                'Score a borrower — all 26 fields optional',          'JSON body: BorrowerInput (defaults apply)'],
                    ['POST', '/api/predict',              'Identical to /api/match (alias)',                     'JSON body: BorrowerInput'],
                    ['GET',  '/api/lenders',              'List all active lender policies',                    '—'],
                    ['POST', '/api/batch-score-upload',   'Batch score from uploaded Excel/CSV file',           'multipart/form-data: file'],
                    ['GET',  '/api/batch-score',          'Score all rows in the training dataset',             '—'],
                    ['POST', '/api/upload-training-data', 'Upload custom training data (Excel/CSV)',            'multipart/form-data: file'],
                    ['POST', '/api/train',                'Train models with SSE live log stream',              'JSON body: TrainConfig'],
                    ['GET',  '/api/model-status',         'Active model name, ROC-AUC, all metrics',           '—'],
                    ['GET',  '/api/training-history',     'All past training run summaries',                   '—'],
                    ['GET',  '/api/export-model',         'Download trained model weights as .pkl',            '—'],
                    ['POST', '/api/upload-outcomes',      'Upload real loan outcomes for feedback loop',       'multipart/form-data: file (.xlsx/.csv)'],
                    ['GET',  '/api/feedback-stats',       'Accumulated feedback stats (totals, breakdown)',    '—'],
                    ['GET',  '/api/outcome-template',     'Download blank outcome feedback template (.xlsx)',  '—'],
                    ['GET',  '/api/template/single',      'Download single-borrower input template (.xlsx)',   '—'],
                    ['GET',  '/api/template/batch',       'Download batch input template (.xlsx)',             '—'],
                    ['POST', '/api/parse-single',         'Parse a single-borrower Excel upload to JSON',     'multipart/form-data: file'],
                    ['GET',  '/api/health',               'Service health check',                             '—'],
                  ].map(([method, path, purpose, params], i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '0.5rem 0.875rem' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.68rem', background: method === 'POST' ? '#DBEAFE' : '#DCFCE7', color: method === 'POST' ? '#1D4ED8' : '#16A34A' }}>
                          {method}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.875rem', fontFamily: 'monospace', color: '#0D9488', fontWeight: 600, whiteSpace: 'nowrap' }}>{path}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#334155' }}>{purpose}</td>
                      <td style={{ padding: '0.5rem 0.875rem', color: '#64748B' }}>{params}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Response schema */}
            <div style={{ background: '#0F172A', borderRadius: '1rem', padding: '1.25rem 1.5rem', marginBottom: '1.25rem' }}>
              <p style={{ color: '#94A3B8', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.75rem' }}>Response Schema (POST /api/match)</p>
              <pre style={{ color: '#E2E8F0', fontSize: '0.75rem', fontFamily: 'monospace', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{`{
  "p_approved":       float,          // Engine 1 — XGBoost approval probability (0–1)
  "primary_model":    string,         // Best model name, e.g. "XGBoost" (ROC-AUC 0.773)
  "model_scores":     { [model]: float }, // All individual model probabilities for comparison
  "score_percentile": int | null,     // Percentile rank among training applicants (0–100)
  "credit_tier":      string | null,  // e.g. "Strong — top 25%" based on score distribution
  "eligible_lenders": int,            // Number of lenders that passed all policy rules
  "total_lenders":    int,            // Total lenders evaluated
  "avg_match_score":  float,          // Average Engine 2 score across eligible lenders
  "w1":               float,          // Weight applied to ML score (typically 0.99 after training)
  "w2":               float,          // Weight applied to Policy score (typically 0.01)
  "weight_explanation": {
    "formula":              string,   // "CombinedScore = 0.99 × P(approved) + 0.01 × MatchScore"
    "how_weights_learned":  string,   // Plain-English explanation of w1/w2 origin
    "interpretation":       string    // Example: "A borrower with P=0.8 and MatchScore=0.7 → 0.76"
  },
  "top3": [                           // Top 3 lenders by combined score
    {
      "rank":                 int,
      "lender_name":          string,
      "combined_score":       float,
      "p_approved":           float,
      "match_score":          float,
      "engine1_contribution": float,  // w1 × p_approved
      "engine2_contribution": float,  // w2 × match_score
      "engine2_rules": [
        {
          "label":         string,    // e.g. "CIBIL Score"
          "passed":        bool,
          "borrower_value":float,
          "lender_min":    float,
          "lender_max":    float,
          "headroom":      float,     // 0–1, comfort margin above minimum threshold
          "narrative":     string     // e.g. "CIBIL 720 vs min 700 (+20 pts)"
        }
      ],
      "match_reasons": [string]       // Summary bullets e.g. "✅ CIBIL 720 ≥ 700"
    }
  ],
  "all_lenders": [ ... ],             // Every lender with eligible flag, scores, contributions
  "shap":    [{"feature": str, "importance": float}],  // 24 features: top-15 + all user inputs guaranteed
  "lime":    [{"condition": str, "weight": float}],    // Top 15 LIME rule weights (signed)
  "bullets": [string]                 // Plain-English narrative bullets for the borrower
}`}</pre>
            </div>

            {/* Code examples */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              {(['curl', 'python', 'js'] as const).map(t => (
                <button key={t} onClick={() => setApiTab(t)} style={{
                  padding: '0.375rem 1rem', borderRadius: 9999, border: 'none',
                  background: apiTab === t ? '#1B3A6B' : '#F1F5F9',
                  color: apiTab === t ? 'white' : '#475569',
                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                }}>
                  {t === 'curl' ? 'cURL' : t === 'python' ? 'Python' : 'JavaScript'}
                </button>
              ))}
            </div>

            {apiTab === 'curl' && (
              <>
                <p style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '0.625rem', fontWeight: 600 }}>Match single borrower (partial fields):</p>
                <Code>{CURL_SINGLE}</Code>
                <p style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '0.625rem', fontWeight: 600 }}>Minimal call — all defaults:</p>
                <Code>{CURL_MINIMAL}</Code>
                <p style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '0.625rem', fontWeight: 600 }}>Batch scoring:</p>
                <Code>{CURL_BATCH}</Code>
              </>
            )}
            {apiTab === 'python' && <Code>{PYTHON_CODE}</Code>}
            {apiTab === 'js' && <Code>{JS_CODE}</Code>}
          </div>
        </Section>

        {/* ── Field Reference ── */}
        <Section title="📖 Borrower Field Reference">
          <div id="fields">
            <p style={{ fontSize: '0.8rem', color: '#64748B', marginBottom: '1rem', lineHeight: 1.6 }}>
              All fields are optional for <code style={{ background: '#F1F5F9', padding: '1px 6px', borderRadius: 4 }}>POST /api/match</code>.
              Monetary fields (<code>loan_min</code>, <code>loan_max</code>, <code>net_sales</code>, <code>pat</code>, <code>tnw</code>) must be in
              raw rupees when calling the API directly. The web form accepts ₹ Lakhs and converts automatically.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#1B3A6B' }}>
                    {['Field', 'Type', 'Required', 'Unit / Range', 'Description & Business Meaning'].map(h => (
                      <th key={h} style={{ padding: '0.625rem 0.75rem', color: 'white', fontWeight: 700, textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.map((f, i) => (
                    <FieldRow key={f.field} {...f} style={{ background: i % 2 === 0 ? 'white' : '#F8FAFC', borderBottom: '1px solid #F1F5F9' }} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}
