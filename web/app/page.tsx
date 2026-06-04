'use client'
import { useState } from 'react'
import Overview from '@/components/Overview'
import Lenders from '@/components/Lenders'
import LenderMatching from '@/components/LenderMatching'
import TrainModel from '@/components/TrainModel'
import BatchScore, { type BatchRow } from '@/components/BatchScore'
import ModelDiagrams from '@/components/ModelDiagrams'
import LoanAnalysis from '@/components/LoanAnalysis'

const TABS = [
  {
    id: 'analysis',
    label: 'FinnUp Insights',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    id: 'overview',
    label: 'Solution Design',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'train',
    label: 'Train Model',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
      </svg>
    ),
  },
  {
    id: 'lenders',
    label: 'Lenders',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10h1v11H4M9 10h1v11H9M14 10h1v11h-1M19 10h1v11h-1" />
      </svg>
    ),
  },
  {
    id: 'match',
    label: 'Predict & Match',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'batch',
    label: 'Portfolio Screening',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    id: 'diagrams',
    label: 'Model Insights',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
]

export default function Home() {
  const [active, setActive] = useState('analysis')
  const [matchPrefill, setMatchPrefill] = useState<BatchRow | null>(null)

  function navigateTo(tab: string, row?: BatchRow) {
    if (row) setMatchPrefill(row)
    setActive(tab)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F0F4F8' }}>

      {/* ── Hero Header ── */}
      <header style={{ background: 'linear-gradient(135deg, #1B3A6B 0%, #0f2548 60%, #0D9488 100%)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {/* Logo mark */}
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
            }}>
              <svg style={{ width: 24, height: 24, color: 'white' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
              </svg>
            </div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 800, fontSize: '1.25rem', margin: 0, letterSpacing: '-0.02em' }}>FinnUp</h1>
              <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem', margin: '2px 0 0' }}>MSME Lender Matching Engine</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <span className="badge" style={{ color: 'rgba(255,255,255,0.9)', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', fontSize: '0.7rem' }}>
              IIM Calcutta · APAL Cohort 2
            </span>
            <span className="badge" style={{ color: 'rgba(255,255,255,0.9)', background: 'rgba(13,148,136,0.35)', border: '1px solid rgba(13,148,136,0.5)', fontSize: '0.7rem' }}>
              Engine 1 (ML) + Engine 2 (Policy)
            </span>
          </div>
        </div>

        {/* ── Nav Tabs ── */}
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 1.5rem' }}>
          <nav style={{ display: 'flex', gap: '0' }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`nav-tab${active === t.id ? ' active' : ''}`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* ── Page content ── */}
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '1.75rem 1.5rem' }}>
        {active === 'overview' && <Overview />}
        {active === 'lenders' && <Lenders />}
        {active === 'match'    && <LenderMatching prefill={matchPrefill} />}
        {active === 'train'    && <TrainModel />}
        {active === 'batch'    && <BatchScore onNavigate={navigateTo} />}
        {active === 'diagrams'  && <ModelDiagrams />}
        {active === 'analysis'  && <LoanAnalysis />}
      </main>

      {/* ── Footer ── */}
      <footer style={{ textAlign: 'center', padding: '1.5rem', marginTop: '1rem', borderTop: '1px solid #E2E8F0' }}>
        <p style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
          FinnUp · MSME Lender Matching · Combined Score = <span style={{ color: '#0D9488', fontWeight: 600 }}>w₁ × P(approved) + w₂ × MatchScore</span>
        </p>
      </footer>
    </div>
  )
}
