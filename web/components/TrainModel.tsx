'use client'
import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, ReferenceLine,
} from 'recharts'

interface ModelMetric {
  model: string; roc_auc: number; pr_auc: number
  f1: number; precision: number; recall: number
}
interface TrainingRun {
  run_id: number; timestamp: string; data_file: string
  n_rows: number; n_features: number; approval_rate: number
  best_model: string; best_roc_auc: number
  metrics: ModelMetric[]; winner_explanation: string[]
}
interface ModelStatus {
  model_exists: boolean; last_trained?: string
  best_model?: string; best_roc_auc?: number
  metrics: ModelMetric[]; last_run?: TrainingRun; total_runs?: number
}
interface FeedbackUpload {
  filename: string; n_rows: number; approved: number; rejected: number; uploaded_at: string
}
interface FeedbackStats {
  total_files: number; total_rows: number
  total_approved: number; total_rejected: number
  approval_rate: number; uploads: FeedbackUpload[]
}

const MODEL_COLORS: Record<string, string> = {
  XGBoost: '#0D9488', LightGBM: '#F59E0B',
  'Random Forest': '#7C3AED', 'Logistic Regression': '#EF4444',
  Stacking: '#1B3A6B', Weighted: '#16A34A',
}
const _color = (name: string) =>
  MODEL_COLORS[name] ??
  MODEL_COLORS[Object.keys(MODEL_COLORS).find(k => name.includes(k)) ?? ''] ??
  '#94A3B8'

export default function TrainModel() {
  const [status, setStatus] = useState<ModelStatus | null>(null)
  const [history, setHistory] = useState<TrainingRun[]>([])
  const [config, setConfig] = useState({
    consol_file: 'Capstone_Consol Sheet_22.05.2026.xlsx',
    upload_path: null as string | null,
    test_size: 0.20, cv_folds: 5,
    use_smote: true, run_ensemble: true, run_weights: true, include_feedback: false,
  })
  const [uploadedFile, setUploadedFile] = useState<{ name: string; n_rows: number | null } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [training, setTraining] = useState(false)
  const [metrics, setMetrics] = useState<ModelMetric[] | null>(null)
  const [explanation, setExplanation] = useState<string[] | null>(null)
  const [histTab, setHistTab] = useState<'table' | 'chart'>('chart')
  const [championInfo, setChampionInfo] = useState<{ promoted: boolean; roc: number; prevRoc: number | null } | null>(null)
  const [feedback, setFeedback] = useState<FeedbackStats | null>(null)
  const [fbUploading, setFbUploading] = useState(false)
  const [fbMsg, setFbMsg] = useState<string | null>(null)
  const [fbErr, setFbErr] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const STEP_LABELS: Record<number, string> = {
    0: 'Resolving data source…',
    1: 'Loading data…',
    2: 'Creating target labels…',
    3: 'Engineering features…',
    4: 'Splitting train / test…',
    5: 'Training LR · RF · XGBoost · LightGBM…',
    6: 'Building ensembles (Weighted + Stacking)…',
    7: 'Optimising weights (scipy + meta-learner)…',
  }
  const currentStep = (() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const m = logs[i].match(/^\[(\d)\//)
      if (m) return parseInt(m[1])
    }
    return training ? 0 : -1
  })()
  const stepDone = !training && logs.some(l => l.includes('[✓] Training complete'))

  function refreshStatus() {
    fetch('/api/model-status').then(r => r.json()).then(setStatus).catch(() => {})
    fetch('/api/training-history').then(r => r.json()).then(d => setHistory(d.runs ?? [])).catch(() => {})
    fetch('/api/feedback-stats').then(r => r.json()).then(setFeedback).catch(() => {})
  }
  useEffect(() => { refreshStatus() }, [])
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadErr(null); setUploadedFile(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/upload-training-data', { method: 'POST', body: fd })
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Upload failed') }
      const data = await res.json()
      setConfig(c => ({ ...c, upload_path: data.path }))
      setUploadedFile({ name: data.filename, n_rows: data.n_rows })
    } catch (err: unknown) {
      setUploadErr(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false); e.target.value = ''
    }
  }

  async function handleOutcomeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFbUploading(true); setFbMsg(null); setFbErr(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/upload-outcomes', { method: 'POST', body: fd })
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Upload failed') }
      const data = await res.json()
      setFbMsg(`✅ Saved ${data.n_rows} outcomes (${data.approved} approved, ${data.rejected} rejected). Approval rate: ${(data.approval_rate * 100).toFixed(1)}%`)
      refreshStatus()
    } catch (err: unknown) {
      setFbErr(err instanceof Error ? err.message : String(err))
    } finally {
      setFbUploading(false); e.target.value = ''
    }
  }

  async function startTraining() {
    setTraining(true); setLogs([]); setMetrics(null); setExplanation(null); setChampionInfo(null)
    try {
      const body: Record<string, unknown> = { ...config }
      if (!body.upload_path) delete body.upload_path
      const res = await fetch('/api/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const payload = JSON.parse(line.slice(5).trim())
            if (payload.type === 'metrics') {
              setMetrics(JSON.parse(payload.message))
              refreshStatus()
            } else if (payload.type === 'explanation') {
              setExplanation(prev => [...(prev ?? []), payload.message])
            } else if (payload.type === 'run_saved') {
              const run = JSON.parse(payload.message) as TrainingRun
              setHistory(prev => [...prev, run])
              refreshStatus()
            } else if (payload.type === 'champion') {
              // Parse promoted/roc from the message text
              const msg: string = payload.message
              const rocMatch = msg.match(/ROC-AUC ([\d.]+)/)
              const prevMatch = msg.match(/champion ([\d.]+)/) || msg.match(/previous champion ([\d.]+)/)
              const roc = rocMatch ? parseFloat(rocMatch[1]) : 0
              const prevRoc = prevMatch ? parseFloat(prevMatch[1]) : null
              setChampionInfo({ promoted: msg.includes('\uD83C\uDFC6') || msg.includes('champion!'), roc, prevRoc })
              setLogs(prev => [...prev, msg])
              refreshStatus()
            } else {
              setLogs(prev => [...prev, payload.message])
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: unknown) {
      setLogs(prev => [...prev, `ERROR: ${err instanceof Error ? err.message : String(err)}`])
    } finally {
      setTraining(false)
    }
  }

  const allModelNames = Array.from(new Set(history.flatMap(r => r.metrics.map(m => m.model))))
  const chartData = history.map(r => ({
    run: `Run ${r.run_id}`,
    ...Object.fromEntries(r.metrics.map(m => [m.model.replace(/\s+/g, '_'), m.roc_auc])),
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.25rem', alignItems: 'start' }}>

        {/* Config panel */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(135deg,#1B3A6B 0%,#234785 100%)', padding: '1.125rem 1.5rem' }}>
            <h2 style={{ color: 'white', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Training Configuration</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', margin: '2px 0 0' }}>4 models + stacking + weight optimisation</p>
          </div>
          <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
            <div style={{ background: '#F8FAFC', borderRadius: '0.75rem', padding: '0.875rem', border: '1px solid #E2E8F0' }}>
              <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1B3A6B', margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Training Data Source</p>
              {uploadedFile ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', color: '#16A34A', fontWeight: 600 }}>UPLOADED: {uploadedFile.name}</span>
                  {uploadedFile.n_rows != null && <span style={{ fontSize: '0.7rem', color: '#64748B' }}>({uploadedFile.n_rows.toLocaleString()} rows)</span>}
                  <button onClick={() => { setUploadedFile(null); setConfig(c => ({ ...c, upload_path: null })) }}
                    style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                </div>
              ) : (
                <div style={{ marginBottom: '0.5rem' }}>
                  <p style={{ fontSize: '0.72rem', color: '#64748B', margin: '0 0 0.375rem' }}>Default: <strong>{config.consol_file}</strong></p>
                  <input className="form-input" value={config.consol_file} style={{ fontSize: '0.75rem' }}
                    onChange={e => setConfig(c => ({ ...c, consol_file: e.target.value }))} />
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                  background: '#F0FDFA', color: '#0D9488', fontWeight: 600, fontSize: '0.75rem',
                  padding: '0.375rem 0.875rem', borderRadius: '0.5rem',
                  border: '1.5px solid #0D9488', cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1,
                }}>
                  {uploading ? 'Uploading...' : 'Upload Training Excel'}
                  <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileUpload} disabled={uploading} />
                </label>
                <a href="/api/training-template" download style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                  background: '#F8FAFC', color: '#475569', fontWeight: 600, fontSize: '0.75rem',
                  padding: '0.375rem 0.875rem', borderRadius: '0.5rem',
                  border: '1.5px solid #CBD5E1', textDecoration: 'none',
                }}>
                  ⬇ Download Template
                </a>
              </div>
              {uploadErr && <p style={{ fontSize: '0.7rem', color: '#EF4444', margin: '0.375rem 0 0' }}>{uploadErr}</p>}
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Test Size</label>
                <span className="slider-value">{(config.test_size * 100).toFixed(0)}%</span>
              </div>
              <p style={{ fontSize: '0.68rem', color: '#64748B', margin: '0 0 4px', lineHeight: 1.5 }}>
                Fraction of data held out for final evaluation. 20% means 80% trains the models, 20% tests them. Higher = less training data but more robust evaluation.
              </p>
              <input type="range" min={10} max={40} step={5} value={config.test_size * 100}
                onChange={e => setConfig(c => ({ ...c, test_size: +e.target.value / 100 }))} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>CV Folds</label>
                <span className="slider-value">{config.cv_folds}</span>
              </div>
              <p style={{ fontSize: '0.68rem', color: '#64748B', margin: '0 0 4px', lineHeight: 1.5 }}>
                K-fold cross-validation splits. Each fold uses (K-1)/K of data to train and 1/K to validate — repeated K times. Higher = more reliable performance estimate, but slower training.
              </p>
              <input type="range" min={3} max={10} value={config.cv_folds}
                onChange={e => setConfig(c => ({ ...c, cv_folds: +e.target.value }))} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {([
                {
                  key: 'use_smote' as const,
                  label: 'Apply SMOTE (handle class imbalance)',
                  desc: 'Synthetic Minority Over-sampling Technique — generates synthetic "approved" examples when approval rate is low (< 40%). Prevents the model from simply predicting "rejected" every time.',
                },
                {
                  key: 'run_ensemble' as const,
                  label: 'Build ensemble models',
                  desc: 'Trains 4 base models (LR + RF + XGBoost + LightGBM) and a Stacking meta-learner. After training, the system benchmarks every model by ROC-AUC and automatically selects the best-performing one for predictions — not always the ensemble. Turn OFF only to debug individual base models.',
                },
                {
                  key: 'run_weights' as const,
                  label: 'Optimise combination weights',
                  desc: 'Learns optimal w₁ (Engine 1 ML weight) and w₂ (Engine 2 Policy weight) using scipy exact search + a Logistic Regression meta-learner. Both methods run and the one with higher ROC-AUC wins. Without this, defaults of 0.60/0.40 are used.',
                },
                {
                  key: 'include_feedback' as const,
                  label: 'Include accumulated outcome feedback',
                  desc: 'Merges real loan outcome data uploaded via the Continuous Learning section below into the training set. More labeled outcomes = better model accuracy over time.',
                },
              ]).map(({ key, label, desc }) => (
                <div key={key} style={{ background: '#F8FAFC', borderRadius: '0.625rem', padding: '0.625rem 0.875rem', border: '1px solid #E2E8F0' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', cursor: 'pointer', fontSize: '0.875rem', color: '#334155' }}>
                    <input type="checkbox" checked={config[key]}
                      onChange={e => setConfig(c => ({ ...c, [key]: e.target.checked }))}
                      style={{ accentColor: '#0D9488', width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{label}</span>
                  </label>
                  <p style={{ fontSize: '0.68rem', color: '#64748B', margin: '0.25rem 0 0 1.625rem', lineHeight: 1.5 }}>{desc}</p>
                </div>
              ))}
            </div>
            <button onClick={startTraining} disabled={training} className="btn-primary">
              {training ? 'Training in progress...' : 'Train Models'}
            </button>
            {status?.model_exists && (
              <a href="/api/export-model" download style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                background: '#F8FAFC', color: '#1B3A6B', fontWeight: 600, fontSize: '0.8rem',
                padding: '0.5rem 1rem', borderRadius: '0.5rem',
                border: '1.5px solid #CBD5E1', cursor: 'pointer', textDecoration: 'none',
              }}>
                Download Trained Model (.pkl)
              </a>
            )}
          </div>
        </div>

        {/* Current model status */}
        <div>
          {status?.model_exists ? <CurrentModelCard status={status} /> : (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3.5rem 2rem', textAlign: 'center', border: '2px dashed #CBD5E1' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.875rem' }}>TRAIN</div>
              <p style={{ fontWeight: 700, color: '#1B3A6B', fontSize: '1rem', marginBottom: 6 }}>No trained model yet</p>
              <p style={{ color: '#64748B', fontSize: '0.8rem' }}>Configure and click Train Models. LR, RF, XGBoost, LightGBM + Ensembles. ~3-5 min.</p>
            </div>
          )}
        </div>
      </div>

      {(training || logs.length > 0) && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* ── Header ── */}
          <div style={{ padding: '0.75rem 1rem', background: '#0F172A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#94A3B8', fontFamily: 'monospace' }}>Training Log</span>
            {training
              ? <span style={{ fontSize: '0.7rem', color: '#4ADE80', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#4ADE80', animation: 'pulse 1.2s ease-in-out infinite' }} />
                  RUNNING
                </span>
              : stepDone
                ? <span style={{ fontSize: '0.7rem', color: '#4ADE80' }}>✓ DONE</span>
                : <span style={{ fontSize: '0.7rem', color: '#F87171' }}>ERROR</span>}
          </div>

          {/* ── Step progress bar ── */}
          {(training || stepDone) && (
            <div style={{ background: '#1E293B', padding: '0.625rem 1rem', borderBottom: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.7rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                  {stepDone ? '✓ All 7 steps complete' : currentStep >= 0 ? `Step ${currentStep} / 7 — ${STEP_LABELS[currentStep]}` : 'Initialising…'}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#64748B', fontFamily: 'monospace' }}>
                  {stepDone ? '100%' : currentStep >= 0 ? `${Math.round((currentStep / 7) * 100)}%` : '0%'}
                </span>
              </div>
              <div style={{ height: 4, background: '#334155', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: stepDone ? '100%' : currentStep >= 0 ? `${Math.round((currentStep / 7) * 100)}%` : '0%',
                  background: stepDone ? '#4ADE80' : 'linear-gradient(90deg, #0D9488, #4ADE80)',
                  borderRadius: 2,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              {training && !stepDone && (
                <p style={{ fontSize: '0.65rem', color: '#475569', margin: '4px 0 0', fontFamily: 'monospace' }}>
                  {currentStep <= 4 ? 'Step 5 (model training) is the longest — ~2–4 min'
                    : currentStep === 5 ? 'Training all 4 models… this is the slowest step'
                    : currentStep === 6 ? 'Building Stacking ensemble with cross-validation…'
                    : 'Scipy + meta-learner weight optimisation…'}
                </p>
              )}
            </div>
          )}

          {/* ── Log output ── */}
          <pre style={{ background: '#0F172A', color: '#CBD5E1', fontSize: '0.72rem', padding: '0.875rem 1rem', overflowY: 'auto', maxHeight: 260, fontFamily: 'monospace', lineHeight: 1.7, margin: 0 }}>
            {logs.length === 0 && training
              ? <span style={{ color: '#475569' }}>Connecting to training server…</span>
              : logs.map((line, i) => {
                  const isStep = /^\[\d\/7\]|^\[✓\]/.test(line)
                  const isErr  = /^ERROR/.test(line)
                  const isWarn = /^⚠️|^\[warn\]/.test(line)
                  const color  = isErr ? '#F87171' : isWarn ? '#FCD34D' : isStep ? '#4ADE80' : '#CBD5E1'
                  return <span key={i} style={{ color, display: 'block' }}>{line}</span>
                })}
            {training && logs.length > 0 && <span style={{ color: '#4ADE80', animation: 'pulse 1s infinite' }}>▋</span>}
          </pre>
          <div ref={logEndRef} />
        </div>
      )}

      {explanation && explanation.length > 0 && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '1rem', padding: '1.25rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#16A34A', marginBottom: '0.875rem' }}>Why this model won</h3>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', listStyle: 'none', padding: 0, margin: 0 }}>
            {explanation.map((line, i) => (
              <li key={i} style={{ fontSize: '0.875rem', color: '#166534', display: 'flex', gap: '0.625rem', lineHeight: 1.5 }}>
                <span style={{ color: '#16A34A', flexShrink: 0 }}>-&gt;</span>
                <span dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Champion promotion result banner */}
      {championInfo && (
        <div style={{
          background: championInfo.promoted ? 'linear-gradient(135deg,#F0FDF4,#DCFCE7)' : 'linear-gradient(135deg,#FFFBEB,#FEF3C7)',
          border: `1px solid ${championInfo.promoted ? '#86EFAC' : '#FDE68A'}`,
          borderRadius: '1rem', padding: '1rem 1.375rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
        }}>
          <div style={{ fontSize: '2rem', flexShrink: 0 }}>{championInfo.promoted ? '\uD83C\uDFC6' : '\u26A0\uFE0F'}</div>
          <div>
            <p style={{ fontWeight: 800, fontSize: '0.9375rem', color: championInfo.promoted ? '#166534' : '#92400E', margin: '0 0 3px' }}>
              {championInfo.promoted
                ? `New champion model! ROC-AUC ${championInfo.roc.toFixed(4)}${championInfo.prevRoc ? ` (+${((championInfo.roc - championInfo.prevRoc) * 100).toFixed(2)} pp improvement)` : ' — first trained model'}`
                : `Previous champion model retained`
              }
            </p>
            <p style={{ fontSize: '0.78rem', color: championInfo.promoted ? '#16A34A' : '#D97706', margin: 0 }}>
              {championInfo.promoted
                ? 'This run\'s model is now active for all predictions.'
                : `This run scored ${championInfo.roc.toFixed(4)} vs champion ${championInfo.prevRoc?.toFixed(4) ?? '—'}. The previous model stays active to protect prediction quality.`
              }
            </p>
          </div>
        </div>
      )}

      {metrics && (
        <div className="card">
          <h3 className="section-title">This Run - Model Performance</h3>
          <MetricsTable metrics={metrics} />
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#1B3A6B', margin: 0 }}>
              Training History - {history.length} run{history.length > 1 ? 's' : ''}
            </h3>
            <div style={{ display: 'flex', gap: '0.375rem' }}>
              {(['chart', 'table'] as const).map(t => (
                <button key={t} onClick={() => setHistTab(t)} style={{
                  padding: '0.3rem 0.875rem', borderRadius: 9999, fontSize: '0.78rem', fontWeight: 600,
                  cursor: 'pointer', border: 'none',
                  background: histTab === t ? '#1B3A6B' : '#F1F5F9',
                  color: histTab === t ? 'white' : '#475569',
                }}>
                  {t === 'chart' ? 'Chart' : 'Table'}
                </button>
              ))}
            </div>
          </div>

          {histTab === 'chart' && chartData.length > 0 && (
            <div>
              <p style={{ fontSize: '0.75rem', color: '#64748B', marginBottom: '0.75rem' }}>ROC-AUC per training run (higher is better, max 1.0)</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="run" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0.5, 1.0]} tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => v.toFixed(2)} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }}
                    formatter={(v: number, name: string) => [v.toFixed(4), name.replace(/_/g, ' ')]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0.85} stroke="#E2E8F0" strokeDasharray="4 2" />
                  {allModelNames.map(name => (
                    <Line key={name} type="monotone" dataKey={name.replace(/\s+/g, '_')} name={name}
                      stroke={_color(name)} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              {history.length >= 2 && (() => {
                const prev = history[history.length - 2]
                const curr = history[history.length - 1]
                const delta = curr.best_roc_auc - prev.best_roc_auc
                return (
                  <div style={{ marginTop: '0.75rem', padding: '0.625rem 0.875rem', borderRadius: '0.5rem', background: delta >= 0 ? '#F0FDF4' : '#FEF2F2' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: delta >= 0 ? '#16A34A' : '#EF4444' }}>
                      {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(2)} pp
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#475569', marginLeft: 6 }}>
                      Run {prev.run_id} to Run {curr.run_id} ({prev.best_roc_auc.toFixed(4)} to {curr.best_roc_auc.toFixed(4)})
                    </span>
                  </div>
                )
              })()}
            </div>
          )}

          {histTab === 'table' && (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr>
                  <th style={{ textAlign: 'center' }}>Run</th><th>Date</th><th>Data File</th>
                  <th style={{ textAlign: 'right' }}>Rows</th><th>Best Model</th>
                  <th style={{ textAlign: 'right' }}>ROC-AUC</th><th style={{ textAlign: 'right' }}>Approval %</th>
                </tr></thead>
                <tbody>
                  {[...history].reverse().map((r, i) => (
                    <tr key={r.run_id} style={{ background: i === 0 ? '#F0FDFA' : undefined }}>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>#{r.run_id}</td>
                      <td style={{ fontSize: '0.8rem', color: '#475569' }}>{r.timestamp.slice(0, 19).replace('T', ' ')}</td>
                      <td style={{ fontSize: '0.8rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.data_file}</td>
                      <td style={{ textAlign: 'right', fontSize: '0.8rem' }}>{r.n_rows.toLocaleString()}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: _color(r.best_model), display: 'inline-block' }} />
                          {r.best_model}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#0D9488' }}>{r.best_roc_auc.toFixed(4)}</td>
                      <td style={{ textAlign: 'right' }}>{(r.approval_rate * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══ Continuous Learning / Feedback Loop ══ */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1B3A6B 0%,#234785 100%)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem' }}>🔄</span>
          <div>
            <h3 style={{ color: 'white', fontWeight: 700, fontSize: '0.9375rem', margin: 0 }}>Continuous Learning — Outcome Feedback</h3>
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.72rem', margin: '2px 0 0' }}>
              Upload real loan decisions to improve the model over time
            </p>
          </div>
        </div>
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* How it works */}
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '0.75rem', padding: '0.875rem 1rem' }}>
            <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1B3A6B', margin: '0 0 0.5rem' }}>How the feedback loop works</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {[
                '1. FinnUp predicts loan approval probability for new applications',
                '2. Lenders disburse or reject — the real outcome is known weeks/months later',
                '3. Upload those actual outcomes here (loan_approved = 0 or 1)',
                '4. On the next training run, check "Include accumulated outcome feedback"',
                '5. Model retrains on base data + real outcomes → accuracy improves over time',
              ].map((s, i) => (
                <p key={i} style={{ fontSize: '0.75rem', color: '#1e3a8a', margin: 0 }}>{s}</p>
              ))}
            </div>
          </div>

          {/* Upload + template */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              background: fbUploading ? '#F1F5F9' : 'linear-gradient(135deg,#0D9488,#0f766e)',
              color: fbUploading ? '#94A3B8' : 'white', fontWeight: 600, fontSize: '0.78rem',
              padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: fbUploading ? 'wait' : 'pointer',
              border: 'none',
            }}>
              {fbUploading ? 'Uploading...' : '⬆ Upload Outcomes (.xlsx / .csv)'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={handleOutcomeUpload} disabled={fbUploading} />
            </label>
            <a href="/api/outcome-template" download style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              background: '#F8FAFC', color: '#1B3A6B', fontWeight: 600, fontSize: '0.78rem',
              padding: '0.5rem 1rem', borderRadius: '0.5rem',
              border: '1.5px solid #CBD5E1', textDecoration: 'none',
            }}>
              ⬇ Download Template
            </a>
          </div>
          {fbMsg && <p style={{ fontSize: '0.78rem', color: '#16A34A', fontWeight: 600, margin: 0 }}>{fbMsg}</p>}
          {fbErr && <p style={{ fontSize: '0.78rem', color: '#DC2626', margin: 0 }}>{fbErr}</p>}

          {/* Accumulated stats */}
          {feedback && feedback.total_files > 0 ? (
            <div>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', margin: '0 0 0.5rem' }}>
                Accumulated feedback — {feedback.total_files} upload{feedback.total_files > 1 ? 's' : ''}, {feedback.total_rows.toLocaleString()} outcomes
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.625rem', marginBottom: '0.75rem' }}>
                {[
                  { label: 'Total Outcomes', value: feedback.total_rows.toLocaleString(), color: '#1B3A6B' },
                  { label: 'Approved', value: feedback.total_approved.toLocaleString(), color: '#16A34A' },
                  { label: 'Rejected', value: feedback.total_rejected.toLocaleString(), color: '#EF4444' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: '#F8FAFC', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', border: '1px solid #E2E8F0', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.125rem', fontWeight: 800, color }}>{value}</div>
                    <div style={{ fontSize: '0.65rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead><tr>
                    <th>File</th>
                    <th style={{ textAlign: 'right' }}>Rows</th>
                    <th style={{ textAlign: 'right' }}>Approved</th>
                    <th style={{ textAlign: 'right' }}>Rejected</th>
                  </tr></thead>
                  <tbody>
                    {feedback.uploads.map((u, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: '0.75rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.filename}</td>
                        <td style={{ textAlign: 'right', fontSize: '0.8rem' }}>{u.n_rows}</td>
                        <td style={{ textAlign: 'right', fontSize: '0.8rem', color: '#16A34A', fontWeight: 600 }}>{u.approved}</td>
                        <td style={{ textAlign: 'right', fontSize: '0.8rem', color: '#EF4444', fontWeight: 600 }}>{u.rejected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.625rem' }}>
                To use this data: enable <strong>"Include accumulated outcome feedback"</strong> in the training config above and click <strong>Train Models</strong>.
              </p>
            </div>
          ) : (
            <div style={{ background: '#F8FAFC', border: '2px dashed #E2E8F0', borderRadius: '0.75rem', padding: '1.5rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.8rem', color: '#94A3B8', margin: 0 }}>No outcome feedback uploaded yet.</p>
              <p style={{ fontSize: '0.72rem', color: '#CBD5E1', margin: '4px 0 0' }}>Upload real loan outcomes above to start the feedback loop.</p>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

function CurrentModelCard({ status }: { status: ModelStatus }) {
  const [expanded, setExpanded] = useState(false)
  const run = status.last_run
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <div style={{ background: 'linear-gradient(135deg,#16A34A 0%,#15803D 100%)', borderRadius: '1rem', padding: '1.125rem 1.5rem', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', opacity: 0.85, margin: 0 }}>ACTIVE MODEL</p>
            <p style={{ fontSize: '1.25rem', fontWeight: 800, margin: '4px 0 0' }}>{status.best_model ?? '-'}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '0.7rem', opacity: 0.85, margin: 0 }}>ROC-AUC</p>
            <p style={{ fontSize: '1.875rem', fontWeight: 800, margin: '2px 0 0' }}>{status.best_roc_auc?.toFixed(4) ?? '-'}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.2)', fontSize: '0.72rem', flexWrap: 'wrap' }}>
          <span>Last trained: {status.last_trained?.replace('T', ' ') ?? '-'}</span>
          {status.total_runs != null && <span>{status.total_runs} run{status.total_runs !== 1 ? 's' : ''} total</span>}
          {run && <span>{run.n_rows.toLocaleString()} rows, {run.n_features} features</span>}
        </div>
      </div>

      {status.metrics.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <button onClick={() => setExpanded(v => !v)} style={{ width: '100%', padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', borderBottom: expanded ? '1px solid #E2E8F0' : 'none' }}>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#1B3A6B' }}>All Model Metrics ({status.metrics.length} models)</span>
            <span style={{ color: '#0D9488', fontSize: '0.75rem', fontWeight: 600 }}>{expanded ? 'Collapse' : 'Expand'}</span>
          </button>
          {expanded && <MetricsTable metrics={status.metrics} />}
        </div>
      )}

      {run?.winner_explanation && run.winner_explanation.length > 0 && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '0.875rem', padding: '1rem 1.25rem' }}>
          <p style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#16A34A', margin: '0 0 0.625rem' }}>
            Why {run.best_model} is the active model
          </p>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', listStyle: 'none', padding: 0, margin: 0 }}>
            {run.winner_explanation.map((line, i) => (
              <li key={i} style={{ fontSize: '0.8125rem', color: '#166534', display: 'flex', gap: '0.5rem' }}>
                <span style={{ color: '#16A34A', flexShrink: 0 }}>-&gt;</span>
                <span dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function MetricsTable({ metrics }: { metrics: ModelMetric[] }) {
  const sorted = [...metrics].sort((a, b) => b.roc_auc - a.roc_auc)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ borderRadius: 0 }}>
        <thead><tr>
          <th style={{ textAlign: 'left' }}>Model</th>
          <th style={{ textAlign: 'right' }}>ROC-AUC</th><th style={{ textAlign: 'right' }}>PR-AUC</th>
          <th style={{ textAlign: 'right' }}>F1</th><th style={{ textAlign: 'right' }}>Precision</th>
          <th style={{ textAlign: 'right' }}>Recall</th>
        </tr></thead>
        <tbody>
          {sorted.map((m, i) => {
            const isWinner = i === 0
            const delta = i === 0 && sorted[1] ? sorted[0].roc_auc - sorted[1].roc_auc : 0
            return (
              <tr key={i} style={{ background: isWinner ? '#F0FDF4' : undefined }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: _color(m.model), flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontWeight: isWinner ? 700 : 500 }}>
                      {isWinner ? '* ' : ''}{m.model}
                    </span>
                    {isWinner && delta > 0.001 && (
                      <span style={{ fontSize: '0.65rem', background: '#DCFCE7', color: '#16A34A', padding: '1px 5px', borderRadius: 9999, fontWeight: 600 }}>
                        +{(delta * 100).toFixed(1)} pp
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ textAlign: 'right', color: isWinner ? '#16A34A' : undefined, fontWeight: isWinner ? 700 : undefined }}>{m.roc_auc.toFixed(4)}</td>
                <td style={{ textAlign: 'right' }}>{m.pr_auc.toFixed(4)}</td>
                <td style={{ textAlign: 'right' }}>{m.f1.toFixed(4)}</td>
                <td style={{ textAlign: 'right' }}>{m.precision.toFixed(4)}</td>
                <td style={{ textAlign: 'right' }}>{m.recall.toFixed(4)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <MetricLegend />
    </div>
  )
}

function MetricLegend() {
  const items = [
    { name: 'ROC-AUC', full: 'Receiver Operating Characteristic — Area Under Curve', meaning: 'How often the model ranks an approved borrower above a rejected one. 0.5 = random, 1.0 = perfect. Primary model-selection criterion.' },
    { name: 'PR-AUC',  full: 'Precision-Recall — Area Under Curve',                  meaning: 'Critical for imbalanced data (8.6% approval rate). Measures quality of approvals found vs false alarms raised. Higher = fewer false approvals.' },
    { name: 'F1',      full: 'F1 Score',                                               meaning: 'Harmonic mean of Precision and Recall. Balances both; useful when approvals are rare and both false positives and false negatives matter.' },
    { name: 'Precision', full: 'Precision',                                            meaning: 'Of all borrowers predicted approved, what fraction were actually approved? High precision = few false approvals.' },
    { name: 'Recall',  full: 'Recall (Sensitivity / True Positive Rate)',              meaning: 'Of all actually approved borrowers, what fraction did the model catch? High recall = few missed opportunities.' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', padding: '0.75rem 0.875rem', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: '0.72rem', color: '#475569' }}>
      <div style={{ fontWeight: 700, color: '#1B3A6B', fontSize: '0.73rem', marginBottom: '0.125rem' }}>Metric Glossary</div>
      {items.map(it => (
        <div key={it.name} style={{ display: 'flex', gap: '0.5rem' }}>
          <span style={{ fontWeight: 700, color: '#0D9488', flexShrink: 0, minWidth: 72 }}>{it.name}</span>
          <span><span style={{ color: '#94A3B8' }}>{it.full} — </span>{it.meaning}</span>
        </div>
      ))}
    </div>
  )
}
