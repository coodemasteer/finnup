'use client'
import { useState, useEffect } from 'react'

interface DiagramInfo { filename: string; title: string }
interface MetricRow {
  model: string; roc_auc: number; pr_auc: number
  f1: number; precision: number; recall: number
}

const CHART_CAPTIONS: Record<string, string> = {
  'roc_pr_curves.png':       'Left: ROC-AUC (higher = better). Right: PR-AUC (critical for 8.6% positive rate — measures precision-recall tradeoff on the minority class).',
  'model_comparison.png':    'Side-by-side ROC-AUC, PR-AUC and F1 across all 4 models + 2 ensembles.',
  'weight_optimisation.png': 'Grid search showing ROC-AUC for each w1/w2 split. Best at w1=1.0 (ML dominates): the ML model already captures lender policy logic.',
  'meta_weight_comparison.png': 'Fixed (0.6/0.4) vs learned meta-learner weights. Improvement is marginal — ML signal is strong enough.',
}

const FI_MODELS = [
  { fname: 'feature_importance_xgboost.png',         name: 'XGBoost ★ (Best Model)' },
  { fname: 'feature_importance_lightgbm.png',        name: 'LightGBM' },
  { fname: 'feature_importance_random_forest.png',   name: 'Random Forest' },
  { fname: 'feature_importance_logistic_regression.png', name: 'Logistic Regression' },
]

const CM_MODELS = [
  { fname: 'confusion_xgboost.png',            name: 'XGBoost' },
  { fname: 'confusion_lightgbm.png',           name: 'LightGBM' },
  { fname: 'confusion_random_forest.png',      name: 'Random Forest' },
  { fname: 'confusion_logistic_regression.png',name: 'Logistic Reg.' },
]

function DiagramCard({ filename, title, caption }: { filename: string; title: string; caption?: string }) {
  const src = `/api/diagrams/${filename}`
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #F1F5F9' }}>
        <h4 style={{ fontWeight: 700, fontSize: '0.875rem', color: '#1B3A6B', margin: 0 }}>{title}</h4>
      </div>
      <img src={src} alt={title} style={{ width: '100%', objectFit: 'contain', display: 'block' }} />
      <div style={{ padding: '0.625rem 1rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, borderTop: '1px solid #F1F5F9' }}>
        {caption && <p style={{ fontSize: '0.7rem', color: '#94A3B8', flex: 1, margin: 0 }}>{caption}</p>}
        <a href={src} download={filename} style={{
          fontSize: '0.75rem', color: '#0D9488', fontWeight: 600,
          textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0
        }}>⬇ Download</a>
      </div>
    </div>
  )
}

export default function ModelDiagrams() {
  const [available, setAvailable] = useState<Set<string>>(new Set())
  const [metrics, setMetrics] = useState<MetricRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/diagrams').then(r => r.json()),
      fetch('/api/metrics').then(r => r.json()),
    ]).then(([dg, mt]) => {
      setAvailable(new Set((dg.diagrams as DiagramInfo[]).map(d => d.filename)))
      setMetrics((mt.metrics as MetricRow[]) ?? [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const has = (f: string) => available.has(f)

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160 }}>
        <div style={{ width: 40, height: 40, border: '4px solid #E2E8F0', borderTopColor: '#0D9488', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (available.size === 0) {
    return (
      <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3.5rem 2rem', textAlign: 'center', border: '2px dashed #CBD5E1' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.875rem' }}>📊</div>
        <p style={{ fontWeight: 700, color: '#1B3A6B', fontSize: '1rem', marginBottom: 6 }}>No Diagrams Found</p>
        <p style={{ color: '#64748B', fontSize: '0.8rem' }}>Run the <strong>Train Model</strong> tab first to generate charts.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      {/* Page header */}
      <div className="card" style={{ padding: '1.125rem 1.5rem', background: 'linear-gradient(135deg,#1B3A6B 0%,#234785 100%)' }}>
        <h2 style={{ color: 'white', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Model Insights &amp; Diagrams</h2>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', margin: '3px 0 0' }}>
          All charts from the latest training run. Click ⬇ Download to save.
        </p>
      </div>

      {/* Row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '1.25rem' }}>
        {has('roc_pr_curves.png') && <DiagramCard filename="roc_pr_curves.png" title="ROC & PR Curves — All Models" caption={CHART_CAPTIONS['roc_pr_curves.png']} />}
        {has('model_comparison.png') && <DiagramCard filename="model_comparison.png" title="Model Comparison" caption={CHART_CAPTIONS['model_comparison.png']} />}
      </div>

      {/* Feature Importance */}
      <div>
        <div className="section-title" style={{ marginBottom: '0.875rem' }}>Feature Importance — Per Model</div>
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '0.75rem', padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#1B3A6B', marginBottom: '1rem' }}>
          <strong>ℹ️ Why features differ:</strong> RF uses Gini impurity gain, XGBoost uses weighted gain per split,
          LightGBM counts raw splits. All agree on core drivers:
          <strong> Entity type, GST compliance, cheque bounces, overdue accounts, CIBIL, DSCR.</strong>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '1.25rem' }}>
          {FI_MODELS.filter(m => has(m.fname)).map(m => (
            <DiagramCard key={m.fname} filename={m.fname} title={m.name} />
          ))}
        </div>
      </div>

      {/* Confusion Matrices */}
      <div>
        <div className="section-title" style={{ marginBottom: '0.875rem' }}>Confusion Matrices</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem' }}>
          {CM_MODELS.filter(m => has(m.fname)).map(m => (
            <div key={m.fname} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1B3A6B', padding: '0.625rem 0.875rem 0.375rem' }}>{m.name}</p>
              <img src={`/api/diagrams/${m.fname}`} alt={m.name} style={{ width: '100%', display: 'block' }} />
              <div style={{ padding: '0.375rem 0.875rem 0.625rem' }}>
                <a href={`/api/diagrams/${m.fname}`} download={m.fname}
                  style={{ fontSize: '0.75rem', color: '#0D9488', fontWeight: 600, textDecoration: 'none' }}>⬇ Download</a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Weight charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '1.25rem' }}>
        {has('weight_optimisation.png') && (
          <DiagramCard filename="weight_optimisation.png" title="Engine 1 vs Engine 2 — Weight Optimisation"
            caption={CHART_CAPTIONS['weight_optimisation.png']} />
        )}
        {has('meta_weight_comparison.png') && (
          <DiagramCard filename="meta_weight_comparison.png" title="Meta-Learner Weight Comparison"
            caption={CHART_CAPTIONS['meta_weight_comparison.png']} />
        )}
      </div>

      {/* Metrics table */}
      {metrics.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#1B3A6B' }}>Model Metrics Summary</span>
            <button onClick={() => {
              const header = 'Model,ROC-AUC,PR-AUC,F1,Precision,Recall'
              const rows = metrics.map(m => `${m.model},${m.roc_auc},${m.pr_auc},${m.f1},${m.precision},${m.recall}`)
              const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
              a.download = 'model_metrics.csv'; a.click()
            }} style={{ fontSize: '0.8rem', color: '#0D9488', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>
              ⬇ CSV
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Model</th>
                  <th style={{ textAlign: 'right' }}>ROC-AUC</th>
                  <th style={{ textAlign: 'right' }}>PR-AUC</th>
                  <th style={{ textAlign: 'right' }}>F1</th>
                  <th style={{ textAlign: 'right' }}>Precision</th>
                  <th style={{ textAlign: 'right' }}>Recall</th>
                </tr>
              </thead>
              <tbody>
                {[...metrics].sort((a, b) => b.roc_auc - a.roc_auc).map((m, i) => (
                  <tr key={i} style={{ background: i === 0 ? '#F0FDF4' : undefined }}>
                    <td style={{ fontWeight: i === 0 ? 700 : 500 }}>
                      {i === 0 && <span style={{ color: '#16A34A', marginRight: 4 }}>★</span>}
                      {m.model}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: i === 0 ? 700 : undefined, color: i === 0 ? '#16A34A' : undefined }}>{m.roc_auc.toFixed(4)}</td>
                    <td style={{ textAlign: 'right' }}>{m.pr_auc.toFixed(4)}</td>
                    <td style={{ textAlign: 'right' }}>{m.f1.toFixed(4)}</td>
                    <td style={{ textAlign: 'right' }}>{m.precision.toFixed(4)}</td>
                    <td style={{ textAlign: 'right' }}>{m.recall.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Metric glossary */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', padding: '0.75rem 1.25rem', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: '0.72rem', color: '#475569' }}>
            <div style={{ fontWeight: 700, color: '#1B3A6B', fontSize: '0.73rem', marginBottom: '0.125rem' }}>Metric Glossary</div>
            {[
              { name: 'ROC-AUC',   full: 'Receiver Operating Characteristic — Area Under Curve', meaning: 'How often the model ranks an approved borrower above a rejected one. 0.5 = random, 1.0 = perfect. Primary model-selection criterion.' },
              { name: 'PR-AUC',   full: 'Precision-Recall — Area Under Curve',                  meaning: 'Critical for imbalanced data (8.6% approval rate). Measures quality of approvals found vs false alarms raised. Higher = fewer false approvals.' },
              { name: 'F1',       full: 'F1 Score',                                               meaning: 'Harmonic mean of Precision and Recall. Balances both; useful when approvals are rare and both false positives and false negatives matter.' },
              { name: 'Precision',full: 'Precision',                                              meaning: 'Of all borrowers predicted approved, what fraction were actually approved? High precision = few false approvals.' },
              { name: 'Recall',   full: 'Recall (Sensitivity / True Positive Rate)',              meaning: 'Of all actually approved borrowers, what fraction did the model catch? High recall = few missed opportunities.' },
            ].map(it => (
              <div key={it.name} style={{ display: 'flex', gap: '0.5rem' }}>
                <span style={{ fontWeight: 700, color: '#0D9488', flexShrink: 0, minWidth: 72 }}>{it.name}</span>
                <span><span style={{ color: '#94A3B8' }}>{it.full} — </span>{it.meaning}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
